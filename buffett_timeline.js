'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// 巴菲特双时间轴：公开重大投资 ＋ 个人净资产（按年龄）。
//
// 三条硬规矩（和本项目其它面板一致）：
// 1. 数字只有一种来源：web/buffett-timeline.json。图、明细表、悬停说明共用同一批
//    数组，同一个数不在两处各算一遍。
// 2. 缺数据显式写「无公开一手来源」，不拿别处的估算顶替——本页只收福布斯或
//    伯克希尔年报这类可查来源，传闻一律不收。
// 3. 颜色与宽度一律走 CSS 类或 CSSOM 赋值：服务器 CSP 是 style-src 'self'，
//    行内 style 属性会被浏览器静默忽略（这个坑本项目已经踩过三次）。
//
// 版面：年份竖着走，中间一根脊轴写「年份 · 年龄」。同一年份用同一条底纹带，
// 左边是那一年的投资，右边是那一年的净资产——年龄和年份因此互相对应。
//
// 为什么竖排而不是横排：横着铺的话两轨要共享一条 x 轴，投资卡又必须留得住
// 「名称／持有时段／核心逻辑／金额／来源」，70 张卡至少 400px 一张，整条轴
// 要拉到两万像素——网页里横滚两万像素没人受得了。竖排用底纹带对齐同年份，
// 一眼扫下去就行。
//
// 金额条用对数刻度（1 亿 → 1 万亿，每格 10 倍）：净资产跨了三个数量级，线性
// 刻度下 1982 年的 2.5 亿会缩成看不见的一根针。刻度固定、不跟数据缩放——
// 刻度一缩放，同一条线上一次的含义就没了。
// ─────────────────────────────────────────────────────────────────────────────
window.BuffettTimeline = (() => {
  const BIRTH_YEAR = 1930;   // 1930-08-30 生；福布斯 9 月发榜时已满当年年龄
  const YEAR_MIN = 1950;
  const YEAR_MAX = 2026;
  const ROW_MIN = 20;       // 一年的最小行高（像素）
  const CARD_H = 76;        // 投资卡片高度（像素）：三行都要露出来——
                            // 名称+时段、核心逻辑、类型/金额/来源，缺一行就等于没给数
  const NW_H = 46;          // 净资产轨道行高度（像素）：金额条 + 数值 + 来源
  const NW_GAP_H = 44;      // 「无公开一手来源 / 待核对」占位行高度（像素）
  const GAP = 8;
  const HEAD_H = 42;        // 顶部表头高度（年份·年龄、金额条刻度尺）
  const NW_DECADES = [1e8, 1e9, 1e10, 1e11, 1e12];  // 金额条刻度：1 亿 → 1 万亿
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const num = (x, n = 0) => x == null ? '—' : Number(x).toLocaleString('zh-CN', { minimumFractionDigits: n, maximumFractionDigits: n });

  // 一笔投资的持有状态：数据里只有「持续／已退出」两种明确口径，
  // 其余（没写、写了别的）一律算「时点未披露」，不许猜成「仍在持有」。
  // 履历标记的形状、表格里的状态栏都读这一个函数——同一个数不许在两处各判一次。
  function holdState(item) {
    return item.holding === '持续' ? 'open' : (item.holding === '已退出' ? 'exit' : 'unknown');
  }

  // 净资产单位统一用美元：正文给「亿美元」，小字给完整美元数。
  function yiText(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const yi = Number(value) / 1e8;
    const digits = yi >= 100 ? 0 : yi >= 1 ? 1 : 2;
    return num(yi, digits) + ' 亿美元';
  }
  function usdText(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return '$' + num(Number(value));
  }
  const ageOf = year => Number(year) - BIRTH_YEAR;

  // 金额条的长度：对数刻度（1 亿 → 1 万亿，每格 10 倍）。
  // 数值本身才是权威值，这条只负责把量级画出来——同一个数、同一个来源，不另算一遍。
  function nwBarPct(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return 0;
    const lo = Math.log10(NW_DECADES[0]);
    const hi = Math.log10(NW_DECADES[NW_DECADES.length - 1]);
    const pct = (Math.log10(v) - lo) / (hi - lo) * 100;
    // 下限 1.5%：最小的一档也得看得见，不能缩成一个点。
    return Math.min(100, Math.max(1.5, pct));
  }

  // 持有时段只有三种合法写法，图上的卡片和明细表共用这一个函数——
  // 两处各写一遍，迟早会出现「卡片说持有至 1996、表里说持续持有」。
  //   holding = '已退出' → 一手年信里查得到退出年
  //   holding = '持续'   → 最新一手来源里仍在
  //   都没写              → 退出时点查不到，明说查不到
  function periodOf(item) {
    if (item.periodText) return item.periodText;
    const year = item.year;
    if (item.holding === '持续') {
      const tail = item.yearEnd ? `（最近一手披露：${item.yearEnd} 年）` : '';
      return `买入 ${year} · 持续持有${tail}`;
    }
    // 「已退出」与「查不到退出年但有 yearEnd」都落到这一支——字面量只许出现一次。
    if (item.yearEnd != null) return `买入 ${year} · 持有至 ${item.yearEnd}`;
    return `买入 ${year}`;
  }

  // 备注与附加来源：明细表给全，卡片只给名字（图上空间有限）。
  function extraNames(item) {
    return (item.extraSources || []).map(source => source.source).filter(Boolean);
  }

  // ── 一生总览 ─────────────────────────────────────────────────────────────
  // 这张图的横轴是**真实线性时间**（一年一年等宽），与下面那条双轨不同——
  // 双轨按内容撑行高，好让同年份左右对齐；总览则要看「哪一年发生了什么」。
  // 纵轴用对数刻度 1 亿 → 1 万亿，与右轨的金额条是同一把尺子。
  const OV = { W: 1000, H: 262, L: 56, R: 18, T: 18, B: 186, BAND: 200, AXIS: 250 };

  function ovYearX(year) {
    return OV.L + (Number(year) - YEAR_MIN) / (YEAR_MAX - YEAR_MIN) * (OV.W - OV.L - OV.R);
  }
  function ovValueY(value) {
    const lo = Math.log10(NW_DECADES[0]);
    const hi = Math.log10(NW_DECADES[NW_DECADES.length - 1]);
    const t = (Math.log10(Number(value)) - lo) / (hi - lo);
    return OV.B - t * (OV.B - OV.T);
  }

  // 总览的数据结构单独抽出来：渲染只是把它画出来，测试也直接验它。
  function overviewSpec(data) {
    const sectors = data.sectors || {};
    const track = (data.netWorth || []).filter(point => point.track !== false && point.netWorth != null);
    const points = track.map(point => ({
      year: Number(point.year), value: Number(point.netWorth),
      x: ovYearX(point.year), y: ovValueY(point.netWorth),
    }));
    // 履历带：同一年多笔就分道 + 横向错开，不叠成一个点。
    const byYear = new Map();
    for (const item of data.investments || []) {
      const year = Number(item.year);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(item);
    }
    const marks = [];
    for (const [year, list] of byYear) {
      const lanes = Math.min(3, list.length);
      const rows = Math.ceil(list.length / lanes);
      list.forEach((item, index) => {
        const lane = index % lanes;
        const round = Math.floor(index / lanes);
        marks.push({
          year, name: item.name, sector: item.sector || '', amount: item.amount || '',
          // 形状即状态：空心＝仍在持有，实心＝已了结，半透明＝退出时点未披露或非持有类条目。
          state: holdState(item),
          x: ovYearX(year) + (round - (rows - 1) / 2) * 5,
          y: OV.BAND + lane * 11,
        });
      });
    }
    // 缺口区间：由数据算出来，不写死年份——福布斯 1982 年才有首榜，
    // 所以「没有公开一手来源」的这一段是从图的最左端一直到第一个有值的年份之前。
    const gapTo = points.length ? Math.min.apply(null, points.map(point => point.year)) - 1 : null;
    const gapFrom = gapTo != null && gapTo >= YEAR_MIN ? YEAR_MIN : null;
    // 行业图例：按笔数排序，一眼看出他把钱压在了哪些行当上。
    const counts = new Map();
    for (const item of data.investments || []) {
      counts.set(item.sector, (counts.get(item.sector) || 0) + 1);
    }
    const legend = [...counts.entries()].map(([key, count]) => ({
      key, count,
      label: (sectors[key] || {}).label || key,
      icon: (sectors[key] || {}).icon || '',
    })).sort((a, b) => b.count - a.count);
    const ticks = [];
    for (let year = 1950; year <= YEAR_MAX; year += 10) {
      ticks.push({ year, x: ovYearX(year) });
    }
    return { points, marks, legend, ticks, gapFrom, gapTo };
  }

  // 曲线上只标关键几个点：标多了就成了一堵字墙。
  const OV_KEY_LABELS = {
    1982: { text: '首榜 2.5 亿', dx: 6, dy: 15, anchor: 'start' },
    1995: { text: '107 亿', dx: 0, dy: -9, anchor: 'middle' },
    2008: { text: '620 亿 · 峰值', dx: 0, dy: -11, anchor: 'middle' },
    2009: { text: '370 亿 · 回撤', dx: 6, dy: 17, anchor: 'start' },
    2026: { text: '1,490 亿', dx: -6, dy: -9, anchor: 'end' },
  };

  function renderOverview(box, data) {
    if (!box) return;
    const spec = overviewSpec(data);
    const sectors = data.sectors || {};
    const grid = NW_DECADES.map(value => {
      const y = ovValueY(value);
      const label = value === 1e8 ? '1亿' : value === 1e9 ? '10亿'
        : value === 1e10 ? '100亿' : value === 1e11 ? '1000亿' : '1万亿';
      return `<line class="ov-grid" x1="${OV.L}" x2="${OV.W - OV.R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`
        + `<text class="ov-axis" x="${OV.L - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${label}</text>`;
    }).join('');
    // 缺口：1982 年之前没有公开一手来源，这一段明写出来。
    let gap = '';
    if (spec.gapFrom != null && spec.gapTo != null) {
      const x1 = ovYearX(spec.gapFrom);
      const x2 = ovYearX(spec.gapTo);
      gap = `<rect class="ov-gap" x="${x1.toFixed(1)}" y="${OV.T}" width="${(x2 - x1).toFixed(1)}" height="${OV.B - OV.T}"/>`
        + `<text class="ov-gap-label" x="${(x1 + 10).toFixed(1)}" y="${OV.T + 16}">${YEAR_MIN}—${spec.gapTo} 无公开一手来源</text>`;
    }
    let curve = '';
    if (spec.points.length) {
      const first = spec.points[0];
      const last = spec.points[spec.points.length - 1];
      const line = spec.points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
      curve = `<path class="ov-area" d="M ${first.x.toFixed(1)} ${OV.B} L ${line.replace(/ /g, ' L ')} L ${last.x.toFixed(1)} ${OV.B} Z"/>`
        + `<polyline class="ov-line" points="${line}"/>`;
      for (const point of spec.points) {
        const key = OV_KEY_LABELS[point.year];
        curve += `<circle class="ov-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${key ? 4 : 2.6}">`
          + `<title>${esc(point.year)} 年（${esc(point.year - BIRTH_YEAR)} 岁）· ${esc(yiText(point.value))}</title></circle>`;
        if (key) {
          curve += `<text class="ov-key-label" x="${(point.x + key.dx).toFixed(1)}" y="${(point.y + key.dy).toFixed(1)}" text-anchor="${key.anchor}">${esc(key.text)}</text>`;
        }
      }
    }
    // 履历带：每笔投资一枚色块，按行业着色，悬停看标的。
    const marks = spec.marks.map(mark => {
      const sector = sectorMeta(sectors, mark.sector);
      const tip = [mark.year + ' 年', mark.name, sector.label, mark.amount].filter(Boolean).join(' · ');
      return `<rect class="ov-mark hold-${mark.state} btl-s-${esc(mark.sector)}" data-name="${esc(mark.name)}" `
        + `x="${(mark.x - 2).toFixed(1)}" y="${mark.y}" width="4" height="7" rx="1">`
        + `<title>${esc(tip)}</title></rect>`;
    }).join('');
    const axis = spec.ticks.map(tick =>
      `<line class="ov-axis-line" x1="${tick.x.toFixed(1)}" x2="${tick.x.toFixed(1)}" y1="${OV.BAND - 4}" y2="${OV.AXIS - 12}"/>`
      + `<text class="ov-year" x="${tick.x.toFixed(1)}" y="${OV.AXIS}" text-anchor="middle">${tick.year}</text>`).join('');
    const legend = spec.legend.map(item =>
      `<span class="ov-legend-item"><i class="ov-key btl-s-${esc(item.key)}"></i>${esc(item.icon)} ${esc(item.label)} ${item.count} 笔</span>`).join('');
    const svg = `<svg class="ov-chart" viewBox="0 0 ${OV.W} ${OV.H}" role="img" aria-label="巴菲特一生的投资履历与个人净资产增长总览">`
      + `<title>巴菲特一生的投资履历与个人净资产增长总览</title>`
      + gap + grid + curve
      + `<text class="ov-band-label" x="${OV.L}" y="${OV.BAND - 7}">投资履历（${(data.investments || []).length} 笔，按行业着色，悬停看标的）</text>`
      + `<rect class="ov-band" x="${OV.L}" y="${OV.BAND - 2}" width="${OV.W - OV.L - OV.R}" height="34"/>`
      + marks + axis
      + `<text class="ov-axis" x="${OV.W - OV.R}" y="${OV.T + 12}" text-anchor="end">净资产（福布斯）· 对数刻度，每格 10 倍</text>`
      + '</svg>';
    box.innerHTML = '<div class="ov-title">一生总览：投资履历与财富增长（1950—2026）</div>' + svg
      + '<div class="ov-legend">' + legend + '</div>'
      + '<div class="ov-legend-note">颜色＝行业；空心＝仍在持有，实心＝已了结，半透明＝退出时点未披露或非持有类条目。'
      + '点标记可定位到下方那张卡片。</div>';
  }

  // 逐年排版：同一年多笔依次下移，行高按内容撑开——这样年份与净资产落点
  // 始终落在同一条底纹带上，不会因为拥挤而错位。
  function layout(data) {
    const investByYear = new Map();
    for (const item of data.investments || []) {
      const year = Number(item.year);
      if (!investByYear.has(year)) investByYear.set(year, []);
      investByYear.get(year).push(item);
    }
    const netByYear = new Map();
    for (const point of data.netWorth || []) {
      // 图上只画每 5 年与关键节点；逐年全量在明细表里——同一批数组，不另算一遍。
      if (point.track === false) continue;
      const year = Number(point.year);
      if (!netByYear.has(year)) netByYear.set(year, []);
      netByYear.get(year).push(point);
    }
    const rows = [];
    let y = HEAD_H;   // 顶上留一行表头：年份·年龄、金额条刻度尺
    for (let year = YEAR_MIN; year <= YEAR_MAX; year += 1) {
      const invest = investByYear.get(year) || [];
      const net = netByYear.get(year) || [];
      const needInvest = invest.length ? invest.length * CARD_H + (invest.length - 1) * GAP : 0;
      const netHeights = net.map(point => (point.netWorth == null ? NW_GAP_H : NW_H));
      const needNet = netHeights.length ? netHeights.reduce((a, b) => a + b, 0) + (netHeights.length - 1) * GAP : 0;
      const height = Math.max(ROW_MIN, needInvest, needNet) + 12;
      rows.push({ year, y, height, invest, net, netHeights });
      y += height;
    }
    return { rows, height: y };
  }

  // 福布斯名次只有是数字时才写「第 N 位」；没核到的写「名次待核对」，
  // 不许拼成「第 待核对 位」那种话。
  function rankText(rank) {
    if (rank == null || rank === '' || rank === '—') return '';
    return /^\d+$/.test(String(rank).trim()) ? '第 ' + rank + ' 位' : '名次待核对';
  }

  // 行业分类只用于展示：徽章、总览着色、图例。分类不承担任何估值或筛选含义。
  function sectorMeta(sectors, key) {
    return (sectors || {})[key] || { label: key || '', icon: '' };
  }

  function investCard(item, sectors) {
    const period = periodOf(item);
    const amount = item.amount ? ` · ${item.amount}` : '';
    const extra = extraNames(item);
    const also = extra.length ? `（另见 ${extra.join('、')}）` : '';
    const meta = `${item.type || ''}${amount}${item.source ? ' · 来源：' + item.source : ''}${also}`;
    // 行业徽章：颜色与图标来自 data.sectors。
    const sector = sectorMeta(sectors, item.sector);
    const badge = item.sector
      ? `<span class="btl-badge btl-s-${esc(item.sector)}" title="${esc(sector.label)}">${esc(sector.icon)}</span>`
      : '';
    return `<article class="btl-card" data-year="${esc(item.year)}" data-name="${esc(item.name)}" data-holding="${esc(item.holding || '')}" title="${esc(meta)}">`
      + `<div class="btl-card-head">${badge}<b>${esc(item.name)}</b><span class="btl-card-period">${esc(period)}</span></div>`
      + `<div class="btl-card-logic">${esc(item.logic || '')}</div>`
      + `<div class="btl-card-meta">${esc(meta)}</div>`
      + '</article>';
  }

  // 右轨一行：金额条 + 数值 + 来源。年份与年龄由中间的脊轴写，这一行不再重复。
  // 缺数据的那几年画的是空心点加「无公开一手来源」，不拿别处的估算顶替。
  function netTrack(point) {
    const missing = point.netWorth == null;
    const status = point.status || (missing ? 'no-source' : 'value');
    const year = point.year;
    const age = ageOf(year);
    if (missing) {
      const label = status === 'pending' ? '待核对：该年榜单数值未取到' : '无公开一手来源';
      const why = status === 'pending' ? '该年榜单存在，数值尚未取到' : '福布斯 1982 年才出首份 400 榜，此前无公开个人净资产口径';
      return `<article class="btl-nw gap${status === 'pending' ? ' pending' : ''}" data-year="${esc(year)}" data-age="${esc(age)}" data-missing="1" data-status="${esc(status)}" title="${esc(point.note || label)}">`
        + `<div class="btl-nw-track"><span class="btl-nw-none">${esc(label)}</span></div>`
        + `<span class="btl-nw-src">${esc(why)}</span></article>`;
    }
    const source = [point.short || point.source || '', rankText(point.rank)].filter(Boolean).join(' · ');
    const pct = nwBarPct(point.netWorth).toFixed(2);
    return `<article class="btl-nw" data-year="${esc(year)}" data-age="${esc(age)}" data-missing="0" data-status="value" title="${esc(source + ' · ' + usdText(point.netWorth))}">`
      + '<div class="btl-nw-track">'
      + `<span class="btl-nw-bar"><span class="btl-nw-fill" data-fill="${pct}"></span>`
      + '<i class="btl-nw-g g1"></i><i class="btl-nw-g g2"></i><i class="btl-nw-g g3"></i></span>'
      + `<b class="btl-nw-val" data-fill="${pct}">${esc(yiText(point.netWorth))}</b></div>`
      + `<span class="btl-nw-src">${esc(source)}</span></article>`;
  }

  // 顶部表头：左列写清楚是什么，中间是年份·年龄，右列顺带就是金额条的刻度尺。
  function colHead(cls, html) {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    return el;
  }

  function netScaleHead() {
    return colHead('btl-nw-head',
      '<span class="btl-nw-scale">'
      + '<i class="btl-nw-g g1"></i><i class="btl-nw-g g2"></i><i class="btl-nw-g g3"></i>'
      + '<em class="btl-nw-lab l0">1亿</em><em class="btl-nw-lab l1">10亿</em>'
      + '<em class="btl-nw-lab l2">100亿</em><em class="btl-nw-lab l3">1000亿</em>'
      + '<em class="btl-nw-lab l4">1万亿</em></span>'
      + '<span class="btl-nw-head-note">净资产（福布斯）<br>对数刻度·每格 10 倍</span>');
  }

  function renderCanvas(canvas, data) {
    const { rows, height } = layout(data);
    canvas.style.height = height + 'px';
    const guides = document.createElement('div');
    guides.className = 'btl-guides';
    const axis = document.createElement('div');
    axis.className = 'btl-col btl-col-axis';
    const invest = document.createElement('div');
    invest.className = 'btl-col btl-col-invest';
    const net = document.createElement('div');
    net.className = 'btl-col btl-col-net';

    // 顶部表头：左列写清楚是什么，中间是年份·年龄，右列顺带就是金额条的刻度尺。
    invest.appendChild(colHead('btl-col-head invest', '公开重大投资'));
    axis.appendChild(colHead('btl-col-head axis', '年份·年龄'));
    net.appendChild(netScaleHead());

    // 「无公开一手来源」那一段在右轨上画成一段斜纹带：
    // 数据里说没有的年份就在那儿空着，读者一眼看出这是缺口，不是页面没画出来。
    const track = (data.netWorth || []).filter(point => point.track !== false);
    const valueYears = track.filter(point => point.netWorth != null).map(point => Number(point.year));
    if (valueYears.length) {
      const first = rows.length ? rows[0].year : YEAR_MIN;
      const last = Math.min.apply(null, valueYears) - 1;
      const startRow = rows.find(row => row.year === first);
      const endRow = rows.find(row => row.year === last);
      if (startRow && endRow) {
        const gap = document.createElement('div');
        gap.className = 'btl-gapband';
        gap.style.top = startRow.y + 'px';
        gap.style.height = (endRow.y + endRow.height - startRow.y) + 'px';
        gap.innerHTML = `<span class="btl-gapband-label">${first}—${last} 无公开一手来源</span>`;
        net.appendChild(gap);
      }
    }

    for (const row of rows) {
      const hasContent = row.invest.length || row.net.length;
      // 每一年都在脊轴上留一道刻度：有内容的年份写年份与年龄，空年份只留一道短线——
      // 中间那根线读起来是一把完整的年份尺，而不是几段孤零零的留白。
      const tick = document.createElement('div');
      tick.className = 'btl-tick' + (hasContent ? '' : ' empty');
      tick.style.top = row.y + 'px';
      const netDot = row.net.some(point => point.netWorth != null) ? '' : ' hollow';
      tick.innerHTML = (hasContent
        ? `<span class="btl-tick-year">${esc(row.year)}</span><span class="btl-tick-age">${esc(ageOf(row.year))} 岁</span>`
        : '')
        + (row.invest.length ? '<i class="btl-dot invest" title="该年有公开重大投资"></i>' : '')
        + (row.net.length ? `<i class="btl-dot net${netDot}" title="该年有净资产节点"></i>` : '');
      axis.appendChild(tick);
      if (!hasContent) continue;

      const band = document.createElement('div');
      band.className = 'btl-band';
      band.style.top = row.y + 'px';
      band.style.height = row.height + 'px';
      guides.appendChild(band);

      row.invest.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'btl-slot';
        card.style.top = (row.y + 8 + index * (CARD_H + GAP)) + 'px';
        card.innerHTML = investCard(item, data.sectors);
        invest.appendChild(card);
      });
      let netOffset = row.y + 8;
      row.net.forEach((point, index) => {
        const card = document.createElement('div');
        card.className = 'btl-slot';
        card.style.top = netOffset + 'px';
        card.innerHTML = netTrack(point);
        // 条长与数值的位置都用 CSSOM 赋值：行内 style 属性会被 CSP 的 style-src 'self' 静默忽略。
        const fill = card.querySelector('.btl-nw-fill');
        if (fill) fill.style.width = (fill.dataset.fill || '0') + '%';
        // 数值骑在条尾：它标的就是这一年的落点，不是悬在右边的另一个数。
        const value = card.querySelector('.btl-nw-val');
        if (value) value.style.left = (value.dataset.fill || '0') + '%';
        net.appendChild(card);
        netOffset += row.netHeights[index] + GAP;
      });
    }
    canvas.appendChild(guides);
    canvas.appendChild(invest);
    canvas.appendChild(axis);
    canvas.appendChild(net);
  }

  function renderTables(box, data) {
    const srcCell = (item) => {
      const link = (label, url) => `<a href="${esc(url)}" target="_blank" rel="noopener">原文</a>`;
      const parts = [item.source ? esc(item.source) : '—'];
      if (item.sourceUrl) parts.push(link('', item.sourceUrl));
      for (const extra of item.extraSources || []) {
        parts.push(esc(extra.source));
        if (extra.sourceUrl) parts.push(link('', extra.sourceUrl));
      }
      return parts.join(' ');
    };
    const invest = (data.investments || []).map(item => `<tr data-year="${esc(item.year)}" data-holding="${esc(item.holding || '')}">`
      + `<td>${esc(item.year)}</td><td class="btl-td-age">${esc(ageOf(item.year))}</td>`
      + `<td><b>${esc(item.name)}</b>${item.ticker ? ' <span class="small muted">' + esc(item.ticker) + '</span>' : ''}`
      + (item.sector ? `<span class="btl-sec-tag btl-s-${esc(item.sector)}">${esc(sectorMeta(data.sectors, item.sector).icon)} ${esc(sectorMeta(data.sectors, item.sector).label)}</span>` : '')
      + '</td>'
      + `<td>${esc(item.type || '')}</td>`
      + `<td>${esc(periodOf(item))}${item.periodNote ? '<span class="btl-td-note">（' + esc(item.periodNote) + '）</span>' : ''}</td>`
      + `<td>${esc(item.amount || '—')}</td>`
      + `<td class="btl-td-logic">${esc(item.logic || '')}</td>`
      + `<td class="btl-td-src">${srcCell(item)}</td>`
      + '</tr>').join('');
    const net = (data.netWorth || []).map(point => {
      const missing = point.netWorth == null;
      const status = point.status || (missing ? 'no-source' : 'value');
      const label = status === 'pending' ? '待核对：该年榜单数值未取到' : '无公开一手来源';
      return `<tr data-year="${esc(point.year)}" data-status="${esc(status)}"${missing ? ' data-missing="1"' : ''}>`
      + `<td>${esc(point.year)}</td><td class="btl-td-age">${esc(ageOf(point.year))}</td>`
      + (missing
        ? `<td class="btl-td-missing">${esc(label)}</td><td>—</td><td>—</td><td>—</td>`
        : `<td>${esc(yiText(point.netWorth))}</td><td>${esc(usdText(point.netWorth))}</td><td>${esc(point.rank || '—')}</td><td>${esc(point.listAge == null ? '—' : point.listAge + ' 岁')}</td>`)
      + `<td class="btl-td-src">${esc(point.source || '—')}${point.sourceUrl ? ' <a href="' + esc(point.sourceUrl) + '" target="_blank" rel="noopener">原文</a>' : ''}</td>`
      + `<td class="btl-td-logic">${esc(point.note || '')}</td>`
      + '</tr>';
    }).join('');
    box.innerHTML = '<div class="btl-table-wrap"><table class="btl-table"><caption>公开重大投资（按年份排序）</caption>'
      + '<thead><tr><th>年份</th><th>年龄</th><th>标的</th><th>类型</th><th>买入 / 持有时段</th><th>金额</th><th>核心逻辑</th><th>来源</th></tr></thead>'
      + '<tbody>' + invest + '</tbody></table></div>'
      + '<div class="btl-table-wrap"><table class="btl-table"><caption>个人净资产（按年龄，单位：美元）</caption>'
      + '<thead><tr><th>年份</th><th>年龄</th><th>净资产</th><th>折美元</th><th>福布斯排名</th><th>福布斯榜上年龄</th><th>数据来源</th><th>说明</th></tr></thead>'
      + '<tbody>' + net + '</tbody></table></div>';
  }

  function renderSummary(head, data) {
    const meta = data.meta || {};
    const investCount = (data.investments || []).length;
    const netCount = (data.netWorth || []).length;
    head.innerHTML = `<div><h2>${esc(meta.title || '巴菲特的两条时间轴')}</h2>`
      + `<p class="muted">${esc(meta.intro || '')}</p></div>`
      + `<div class="btl-summary">`
      + `<span><b>${investCount}</b> 笔公开重大投资</span>`
      + `<span><b>${netCount}</b> 个净资产节点</span>`
      + `<span>${esc(meta.coverage || '')}</span>`
      + '</div>';
  }

  // 把一张卡片滚进滚动框的视野里，放在视口顶端往下 margin 处。
  //
  // 两个坑：
  // 1. 卡片挂在绝对定位的 slot 上，card.offsetTop 落的是 slot 的位置（0），不是
  //    内容里的位置。所以只能用实测矩形。
  // 2. 基准必须是滚动框自身的视口位置——它不随内容滚动而移动。画布（.btl-canvas）
  //    会被内容带着滚，拿它当基准只在 scrollTop=0 时碰巧对；用户先滚过时间轴再
  //    点总览标记，就会滚不到位。
  function scrollCardIntoView(scroll, card, margin) {
    const cardRect = card.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const offsetInContent = scroll.scrollTop + (cardRect.top - scrollRect.top);
    scroll.scrollTop = Math.max(0, offsetInContent - margin);
    return scroll.scrollTop;
  }

  // 总览与明细是同一份数据的两个视图，所以要能互相指认：悬停总览里的标记，
  // 下方那张卡片就亮起来；点一下直接把卡片滚到眼前。悬停卡片同理。
  function linkOverviewAndTrack(root) {
    const overview = root.querySelector('.btl-overview');
    const scroll = root.querySelector('.btl-scroll');
    if (!overview || !scroll) return;
    const marks = [...overview.querySelectorAll('.ov-mark')];
    const cards = [...root.querySelectorAll('.btl-card')];
    if (!marks.length || !cards.length) return;
    const cardByName = new Map();
    for (const card of cards) cardByName.set(card.dataset.name, card);
    const markByName = new Map();
    for (const mark of marks) markByName.set(mark.dataset.name, mark);
    const clear = () => {
      for (const el of marks) el.classList.remove('btl-hit');
      for (const el of cards) el.classList.remove('btl-hit');
    };
    const light = (mark, card) => {
      clear();
      if (mark) mark.classList.add('btl-hit');
      if (card) card.classList.add('btl-hit');
    };
    for (const mark of marks) {
      const card = cardByName.get(mark.dataset.name);
      if (!card) continue;
      mark.addEventListener('mouseenter', () => light(mark, card));
      mark.addEventListener('mouseleave', clear);
      mark.addEventListener('click', () => {
        light(mark, card);
        scrollCardIntoView(scroll, card, 140);
      });
    }
    for (const card of cards) {
      const mark = markByName.get(card.dataset.name);
      if (!mark) continue;
      card.addEventListener('mouseenter', () => light(mark, card));
      card.addEventListener('mouseleave', clear);
    }
  }

  function render(root, data) {
    if (!root) return;
    const head = root.querySelector('.btl-head');
    const canvas = root.querySelector('.btl-canvas');
    const tables = root.querySelector('.btl-tables');
    const overview = root.querySelector('.btl-overview');
    const notice = root.querySelector('.btl-notice');
    const note = root.querySelector('.btl-note');
    if (head) renderSummary(head, data);
    if (note) note.textContent = (data.meta && data.meta.note) || '';
    if (overview) renderOverview(overview, data);
    if (canvas) { canvas.innerHTML = ''; renderCanvas(canvas, data); }
    if (tables) renderTables(tables, data);
    if (notice) { notice.textContent = ''; notice.hidden = true; }
    linkOverviewAndTrack(root);
  }

  function fail(root, message) {
    if (!root) return;
    const notice = root.querySelector('.btl-notice');
    const canvas = root.querySelector('.btl-canvas');
    if (canvas) canvas.innerHTML = '';
    if (notice) { notice.textContent = message; notice.hidden = false; }
  }

  // 数据文件跟脚本放在同一目录：私有服务器从根路径取，静态站点随站点根目录取。
  function dataUrl() {
    const script = document.querySelector('script[src*="buffett_timeline.js"]');
    const base = script && script.src ? new URL('.', script.src).href : new URL('.', location.href).href;
    return new URL('buffett-timeline.json', base).href;
  }

  async function load() {
    const root = document.getElementById('buffett-timeline');
    if (!root) return null;
    try {
      const response = await fetch(dataUrl(), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw Error('HTTP ' + response.status);
      const data = await response.json();
      render(root, data);
      return data;
    } catch (err) {
      fail(root, '时间轴数据没取到（' + err.message + '）。没有数据就不画，也不拿别处的数字顶替。');
      return null;
    }
  }

  function boot() { load(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { load, render, layout, yiText, usdText, ageOf, periodOf, nwBarPct, overviewSpec, scrollCardIntoView, BIRTH_YEAR, YEAR_MIN, YEAR_MAX, NW_DECADES };
})();
