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
// ─────────────────────────────────────────────────────────────────────────────
window.BuffettTimeline = (() => {
  const BIRTH_YEAR = 1930;   // 1930-08-30 生；福布斯 9 月发榜时已满当年年龄
  const YEAR_MIN = 1950;
  const YEAR_MAX = 2026;
  const ROW_MIN = 20;       // 一年的最小行高（像素）
  const CARD_H = 76;        // 投资卡片高度（像素）：三行都要露出来——
                            // 名称+时段、核心逻辑、类型/金额/来源，缺一行就等于没给数
  const NW_H = 46;          // 净资产卡片高度（像素）
  const NW_GAP_H = 44;      // 「无公开一手来源 / 待核对」占位卡高度（像素）
  const GAP = 8;
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const num = (x, n = 0) => x == null ? '—' : Number(x).toLocaleString('zh-CN', { minimumFractionDigits: n, maximumFractionDigits: n });

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
    let y = 0;
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

  function investCard(item) {
    const period = periodOf(item);
    const amount = item.amount ? ` · ${item.amount}` : '';
    const extra = extraNames(item);
    const also = extra.length ? `（另见 ${extra.join('、')}）` : '';
    const meta = `${item.type || ''}${amount}${item.source ? ' · 来源：' + item.source : ''}${also}`;
    return `<article class="btl-card" data-year="${esc(item.year)}" data-name="${esc(item.name)}" data-holding="${esc(item.holding || '')}" title="${esc(meta)}">`
      + `<div class="btl-card-head"><b>${esc(item.name)}</b><span class="btl-card-period">${esc(period)}</span></div>`
      + `<div class="btl-card-logic">${esc(item.logic || '')}</div>`
      + `<div class="btl-card-meta">${esc(meta)}</div>`
      + '</article>';
  }

  function netCard(point) {
    const missing = point.netWorth == null;
    const status = point.status || (missing ? 'no-source' : 'value');
    const label = status === 'pending' ? '待核对：该年榜单数值未取到' : '无公开一手来源';
    const head = `<div class="btl-nw-top"><span class="btl-nw-age">${esc(ageOf(point.year))} 岁</span>`
      + `<span class="btl-nw-year">${esc(point.year)}</span>`;
    if (missing) {
      return `<article class="btl-nw gap${status === 'pending' ? ' pending' : ''}" data-year="${esc(point.year)}" data-age="${esc(ageOf(point.year))}" data-missing="1" data-status="${esc(status)}" title="${esc(point.note || '')}">`
        + head + `<span class="btl-nw-none">${esc(label)}</span></article>`;
    }
    const source = [point.short || point.source || '', point.rank && point.rank !== '—' ? '第 ' + point.rank + ' 位' : ''].filter(Boolean).join(' · ');
    return `<article class="btl-nw" data-year="${esc(point.year)}" data-age="${esc(ageOf(point.year))}" data-missing="0" data-status="value" title="${esc(source)}">`
      + head + `<b class="btl-nw-val">${esc(yiText(point.netWorth))}</b></div>`
      + `<span class="btl-nw-usd" title="${esc(usdText(point.netWorth))}">${esc(source)}</span></article>`;
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

    for (const row of rows) {
      const hasContent = row.invest.length || row.net.length;
      if (!hasContent) continue;
      const band = document.createElement('div');
      band.className = 'btl-band';
      band.style.top = row.y + 'px';
      band.style.height = row.height + 'px';
      guides.appendChild(band);
      const tick = document.createElement('div');
      tick.className = 'btl-tick';
      tick.style.top = row.y + 'px';
      tick.innerHTML = `<span class="btl-tick-year">${esc(row.year)}</span><span class="btl-tick-age">${esc(ageOf(row.year))} 岁</span>`;
      axis.appendChild(tick);
      row.invest.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'btl-slot';
        card.style.top = (row.y + 8 + index * (CARD_H + GAP)) + 'px';
        card.innerHTML = investCard(item);
        invest.appendChild(card);
      });
      let netOffset = row.y + 8;
      row.net.forEach((point, index) => {
        const card = document.createElement('div');
        card.className = 'btl-slot';
        card.style.top = netOffset + 'px';
        card.innerHTML = netCard(point);
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
      + `<td><b>${esc(item.name)}</b>${item.ticker ? ' <span class="small muted">' + esc(item.ticker) + '</span>' : ''}</td>`
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

  function render(root, data) {
    if (!root) return;
    const head = root.querySelector('.btl-head');
    const canvas = root.querySelector('.btl-canvas');
    const tables = root.querySelector('.btl-tables');
    const notice = root.querySelector('.btl-notice');
    const note = root.querySelector('.btl-note');
    if (head) renderSummary(head, data);
    if (note) note.textContent = (data.meta && data.meta.note) || '';
    if (canvas) { canvas.innerHTML = ''; renderCanvas(canvas, data); }
    if (tables) renderTables(tables, data);
    if (notice) { notice.textContent = ''; notice.hidden = true; }
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

  return { load, render, layout, yiText, usdText, ageOf, periodOf, BIRTH_YEAR, YEAR_MIN, YEAR_MAX };
})();
