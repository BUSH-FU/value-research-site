'use strict';

// 批量测算视图：中性情景下的每股内在价值与安全边际。
//
// 自动估值尚未经研究复核：预测用自动草案（最近五年 FCFF 中位数平推五年，
// 零显性增长），永续增长率没有官方值，所以给 1%/2%/3% 三档敏感性。
// 结果不写入估值存档，也不进最终候选。
//
// 口径分两步（巴菲特式）：
// 1. 先估「大概率能实现的内在价值」= 中性情景：现金流用自动草案原值
//    （不预先假设未来变差 20%），WACC 取当前口径，只对永续增长率取三档。
//    这一档是「大概率能实现」的内在价值，不是灾难情景。
// 2. 再在中性内在价值上打安全边际折扣（常见 20%）。折扣的作用是抵消我自己
//    预测的误差，不是提前假设「未来一定变差」。
//    价格条件 = 1 − 收盘价 ÷ 中性中枢 ≥ 门槛。
//
// 定性筛选在前、估值折扣在后：ROIC 持续高于 WACC、有护城河、现金流稳定、
// 杠杆可控那一套在「严格财务预筛」和「投资核查清单」里，本页只管价格。
//
// 原 24 组机械压力情景保留，改名「压力校验区间」，只做辅助观察，不控制价格
// 条件——那是灾难情景，拿它当门槛会把所有公司都判成不合格。
//
// 三条硬规矩（和市场情绪、周期那页一致）：
// 1. 数字只有一种来源：服务器算好的真实读数。缺数据写「缺什么」，不拿示例值顶替。
// 2. 区间和阈值必须画成图，并且标出落点——三档永续增长率本身就是一条区间，
//    所以每家画一条区间带，落点标已定档（1%），再把中性门槛线和 0 轴画出来。
// 3. 颜色与宽度一律走 CSS 类或 CSSOM 赋值：服务器 CSP 是 style-src 'self'，
//    行内 style 属性会被浏览器静默忽略（这个坑本项目已经踩过三次）。
window.ValuationScenarios = (() => {
 const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num = (x, n=2) => x === null || x === undefined || x === '' ? '—' : Number(x).toLocaleString('zh-CN', {maximumFractionDigits:n, minimumFractionDigits:n});
 const isNum = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
 const pct1 = x => isNum(x) ? num(Number(x) * 100, 1) + '%' : '—';
 const KEYS = ['g1%','g2%','g3%'];
 // 中枢档 = 用户 2026-10-31 拍板取的那一档（永续增长率 1%，保守档）。
 // 展示层仍给全量：1%/2%/3% 三档全画出来、带子全量展示；
 // 判断层只用已定的那一档——一个数只干一件事，别让页面留两套价格条件。
 const MID = 'g1%';
 const MID_LABEL = '1%';
 const AXIS_MIN = -100;   // 横轴左端：低于这个值的区间折叠到边缘并标记 ◀
 const AXIS_MAX = 90;     // 横轴右端

 let last = null;
 let selectedBasis = 'coverage';
 // 表格排序与区间图共用一套行顺序：用户在表里排完，图就按同一个顺序重画，
 // 否则「图上一家、表里另一家」会让人以为两处算的不是一回事。
 const SLOT_MAIN = 'scenarios:main';
 const SLOT_SUPP = 'scenarios:supp';
 const orderSlots = new Map();
 function applyOrder(slot, keys){ if(slot) orderSlots.set(slot, (keys||[]).slice()); }
 function selectBasis(value){if(['coverage','latest','median','mean'].includes(value))selectedBasis=value;}

 const scenarioOf = (row, key) => (((row || {}).scenario || {}).scenarios || {})[key] || {};
 const margins = row => KEYS.map(k => scenarioOf(row, k).margin).filter(isNum).map(Number);
 // 安全边际在数据里是小数（0.668），门槛是百分数（30）。图上的横轴是百分数，
 // 所以画图前一律换成百分点再比、 再定位——把小数直接当百分点会整体错位。
 const marginPcts = row => margins(row).map(v => v * 100);
 const meetsThreshold = (margin, threshold) => isNum(margin) && Number(margin) * 100 >= threshold;

 // ── 中性情景（主判断口径）─────────────────────────────────────────────────
 // 中性情景 = 现金流用自动草案原值 + 当前口径 WACC，只对永续增长率取三档。
 // 它回答的是「大概率能实现的内在价值是多少」，不是「最坏情况会怎样」。
 function neutralBand(row){
  const values = KEYS.map(k => scenarioOf(row, k))
   .filter(s => s.valid !== false && isNum(s.per_share) && Number(s.per_share) > 0)
   .map(s => Number(s.per_share));
  return {low: values.length ? Math.min(...values) : null, high: values.length ? Math.max(...values) : null};
 }
 // 中枢取已定档（1%）：永续增长率没有官方值，但用户 2026-10-31 已拍板取保守档 1%。
 // 三档仍然并列展示（看换一个假设会怎样），判断层只用已定的那一档。
 function neutralOf(row){
  const scen = scenarioOf(row, MID);
  const per = (scen.valid !== false && isNum(scen.per_share) && Number(scen.per_share) > 0) ? Number(scen.per_share) : null;
  const price = isNum(scen.price) ? Number(scen.price) : null;
  // 报价过期、跨源不一致、停牌时服务端根本不填 price，宁可不比也不拿旧价凑数。
  // 股权为负时 compare_state 会被改成 invalid，但 per 为 null，同样不可比。
  const comparable = per !== null && price !== null;
  const margin = comparable ? (isNum(scen.margin) ? Number(scen.margin) : 1 - price / per) : null;
  const band = neutralBand(row);
  return {scen, per, price, comparable, margin, low: band.low, high: band.high,
          priceDate: scen.price_date || '—', reason: scen.compare_reason || ''};
 }
 // 中性 20% 门槛 = 中性中枢 ×（1 − 门槛）。折扣只作用在这里，不作用在现金流上。
 const neutralTarget = (per, threshold) => (per === null || !isNum(threshold)) ? null : per * (1 - Number(threshold) / 100);
 // 价格条件只看中性情景；压力情景不参与这个判断。
 // 真「股权价值为负」的标的已经在 rowsOf 里剔除了，进到这里只可能是「算不出来」，
 // 所以这里写「无法测算」，不能再写「股权价值为负」——那是另一种情况。
 function neutralCondition(neu, threshold, validThreshold){
  if(neu.per === null){
   return neu.low === null
    ? '中性情景三档均无法测算，不参与价格判断'
    : `中性中枢档（${MID_LABEL}）无法测算，不参与价格判断（另两档仍有正估值）`;
  }
  if(!validThreshold) return '请配置安全边际门槛';
  if(!neu.comparable) return '报价不可比较' + (neu.reason ? '：' + neu.reason : '');
  const target = neutralTarget(neu.per, threshold);
  return neu.price <= target ? '达到价格条件，仍需研究复核'
   : '尚未达到价格条件（未达 ' + num(threshold, 0) + '% 安全边际）';
 }
 // 自动草案把报表货币资金按 0 计（尚未辨别可分配现金）。「股权价值为负」必须
 // 带上这个假设，否则会被读成公司资不抵债——实际可能只是漏算了账上的现金。
 // 这里算出「若把货币资金计入」的股权价值与每股，让读者自己判断这个假设的影响。
 function cashAdjusted(row){
  const forecast = (row.scenario||{}).forecast || {};
  const cashYi = isNum(forecast.cash_not_counted_yi) ? Number(forecast.cash_not_counted_yi) : null;
  const scen = scenarioOf(row, MID);
  const equity = isNum(scen.equity_value) ? Number(scen.equity_value) : null;
  const sharesYi = isNum(forecast.shares_yi) ? Number(forecast.shares_yi) : null;
  if(cashYi === null || cashYi <= 0 || equity === null || !sharesYi || sharesYi <= 0) return null;
  const withCash = equity + cashYi * 1e8;
  return {cashYi, equityYi: equity / 1e8, equityWithCashYi: withCash / 1e8,
          perShare: withCash / (sharesYi * 1e8),
          perShareIgnored: isNum(forecast.cash_per_share_ignored) ? Number(forecast.cash_per_share_ignored) : null};
 }
 // 负股权那一格的说明：说清「现金按 0 计」这个假设，剔不剔得由人自己复核。
 function negativeEquityNote(row){
  const cash = cashAdjusted(row);
  if(!cash) return '<span class="small muted">自动草案的货币资金或总股本数据不全，无法核对</span>';
  return `<span class="small muted">自动草案把报表货币资金 ${num(cash.cashYi)} 亿按 0 计</span>`;
 }

 // ── DCF 股权价值为负 → 直接剔除 ─────────────────────────────────────────────
// DCF 算出股权价值为负，说明企业价值连有息债务与少数股东权益都覆盖不了，
// 谈不上持续创造超额收益，这类标的直接剔除，不进主表、不参与排序。
//
// 判定口径：中性情景三档（永续增长率 1%/2%/3%）股权价值**全为负**才算命中——
// 某一档算不出来、或某一档为正，都不叫「股权价值为负」。
// 剔除用的是自动草案口径（报表货币资金按 0 计）；被剔的公司会在清单里写明
// 漏算了多少现金、计入后是什么数，便于自己复核这个剔除是否合理。
 function isNegativeEquity(row){
  const scen = scenarioOf(row, MID);
  if(scen.valid !== false) return false;
  if(!isNum(scen.equity_value) || Number(scen.equity_value) >= 0) return false;
  return KEYS.every(key => {
   const item = scenarioOf(row, key);
   return item.valid === false && isNum(item.equity_value) && Number(item.equity_value) < 0;
  });
 }

 function rowsOf(data, slot, dropNegative){
  const rows=(data?.rows||[]).filter(r=>r?.scenario?.ready);
  const order=slot?orderSlots.get(slot):null;
  if(!order||!order.length) return dropNegative?rows.filter(row=>!isNegativeEquity(row)):rows;
  const rank=new Map();
  order.forEach((code,index)=>{if(!rank.has(code))rank.set(code,index);});
  const ordered=rows.map((row,index)=>({row,index,rank:rank.has(row.code)?rank.get(row.code):Number.MAX_SAFE_INTEGER}))
   .sort((a,b)=>(a.rank-b.rank)||(a.index-b.index))
   .map(item=>item.row);
  return dropNegative?ordered.filter(row=>!isNegativeEquity(row)):ordered;
 }

 function axisDomain(data){
  const rows = rowsOf(data, SLOT_MAIN, true);
  let min = 0, max = 0;
  for(const row of rows){
   const values = marginPcts(row);
   if(!values.length) continue;
   min = Math.min(min, ...values);
   max = Math.max(max, ...values);
  }
  const threshold = Number(data?.margin_min_pct) || 0;
  const lo = Math.max(AXIS_MIN, Math.min(0, Math.floor(min / 10) * 10));
  const hi = Math.max(threshold + 10, Math.min(AXIS_MAX, Math.ceil(max / 10) * 10));
  return {lo, hi: hi > lo ? hi : lo + 10};
 }

 function bandChart(data){
  const rows = rowsOf(data, SLOT_MAIN, true);
  if(!rows.length) return '<p class="small muted">目前没有能测算的公司。</p>';
  const threshold = Number(data?.margin_min_pct) || 0;
  const {lo, hi} = axisDomain(data);
  const W = 1080, NAME_W = 158, VAL_W = 132, TOP = 34, ROW_H = 32, BOTTOM = 48;
  const plotLeft = NAME_W, plotRight = W - VAL_W;
  const height = TOP + rows.length * ROW_H + BOTTOM;
  const x = v => plotLeft + (plotRight - plotLeft) * (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo);
  const y = i => TOP + i * ROW_H + ROW_H / 2;

  const ticks = [];
  const tickValues = [];
  for(let v = Math.ceil(lo / 20) * 20; v < hi; v += 20) tickValues.push(v);
  tickValues.push(hi);   // 轴上限一定要有刻度，否则最右边的区间看不出被截断
  for(const v of tickValues){
   ticks.push(`<g><line x1="${x(v).toFixed(1)}" y1="${TOP - 6}" x2="${x(v).toFixed(1)}" y2="${height - BOTTOM + 4}" class="vs-grid"/><text x="${x(v).toFixed(1)}" y="${height - BOTTOM + 22}" text-anchor="middle" class="vs-axis">${v}%</text></g>`);
  }
  const safeZone = `<rect x="${x(threshold).toFixed(1)}" y="${TOP - 6}" width="${(plotRight - x(threshold)).toFixed(1)}" height="${(height - BOTTOM + 4 - TOP + 6).toFixed(1)}" class="vs-safe-zone"/>`;
  const zeroLine = `<line x1="${x(0).toFixed(1)}" y1="${TOP - 6}" x2="${x(0).toFixed(1)}" y2="${height - BOTTOM + 4}" class="vs-zero"/>`;
  const thresholdLine = `<line x1="${x(threshold).toFixed(1)}" y1="${TOP - 12}" x2="${x(threshold).toFixed(1)}" y2="${height - BOTTOM + 4}" class="vs-threshold"/><text x="${x(threshold).toFixed(1)}" y="${TOP - 18}" text-anchor="middle" class="vs-threshold-label">${threshold}% 中性门槛</text>`;

  const body = rows.map((row, index) => {
   const values = marginPcts(row);
   const hasBand = values.length > 0;
   const low = hasBand ? Math.min(...values) : 0;
   const high = hasBand ? Math.max(...values) : 0;
   const midScenario = scenarioOf(row, MID);
   const mid = midScenario.margin;
   const midValid = isNum(mid);
   const midPct = midValid ? Number(mid) * 100 : null;
   const clipped = hasBand && low < lo;
   const tone = midPct === null ? 'negative' : (midPct >= threshold ? 'positive' : (midPct >= 0 ? 'thin' : 'negative'));
   const x1 = x(low), x2 = x(high);
   // 压力校验下限（辅助观察）：把「按压力下限还剩多少安全边际」折算到同一条轴上，
   // 落点必然在中性带左侧；超出坐标轴时折到左端并改用虚线。
   const stress = row.scenario.stress || {};
   const stressLow = stress.complete === true && isNum(stress.low) && Number(stress.low) > 0 ? Number(stress.low) : null;
   const stressPct = (stressLow !== null && isNum(midScenario.price)) ? (1 - Number(midScenario.price) / stressLow) * 100 : null;
   const stressX = stressPct === null ? null : x(stressPct);
   // 从压力下限连一条淡虚线到中性带左端：这一段就是「中性结论离灾难情景还有多远」。
   const stressLink = (stressX !== null && hasBand)
    ? `<line x1="${Math.min(stressX, x1).toFixed(1)}" y1="${y(index).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y(index).toFixed(1)}" class="vs-stress-link"/>` : '';
   // 压力下限折到轴外时不再画小竖线：它会和区间自己的 ◀ 撞在一起，只留淡虚线。
   const stressMark = (stressX === null || stressPct < lo) ? '' :
    `<line x1="${stressX.toFixed(1)}" y1="${(y(index) - 7).toFixed(1)}" x2="${stressX.toFixed(1)}" y2="${(y(index) + 7).toFixed(1)}" class="vs-stress-mark${stressPct < lo ? ' off' : ''}"/>`;
   const title = KEYS.map(k => {
    const s = scenarioOf(row, k);
    const per = s.valid === false ? '股权价值为负（不参与比较）' : (isNum(s.per_share) ? '¥' + num(s.per_share) : '无效');
    return `${k}：每股 ${per}，安全边际 ${pct1(s.margin)}`;
   }).join('；') + (hasBand ? `；带宽 ${num(high - low, 1)} 个百分点（永续增长率 1%～3% 之间安全边际的摆动幅度）` : '')
   + (stressLow !== null && isNum(midScenario.price)
    ? `；压力校验下限 ¥${num(stressLow)}，按它算安全边际只剩 ${pct1(1 - Number(midScenario.price) / stressLow)}（仅供辅助观察，不控制价格条件）` : '')
   + (!hasBand ? (() => { const cash = cashAdjusted(row);
        return cash ? `；自动草案把报表货币资金 ${num(cash.cashYi)} 亿按 0 计，计入后 ${MID_LABEL} 档股权价值 ${num(cash.equityWithCashYi)} 亿、每股 ${num(cash.perShare)} 元` : ''; })() : '');
   const mark = clipped ? `<text x="${plotLeft + 6}" y="${y(index) + 4}" class="vs-clipped">◀</text>` : '';
   const dot = midValid ? `<circle cx="${x(midPct).toFixed(1)}" cy="${y(index)}" r="5.5" class="vs-dot ${tone}"/>` : '';
   const label = midValid ? pct1(mid) : (isNum(midScenario.per_share) ? '股权为负' : '—');
   const band = hasBand ? `<rect x="${x1.toFixed(1)}" y="${(y(index) - 7).toFixed(1)}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="14" rx="4" class="vs-band ${tone}"/>` : '';
   // 带宽写在数值下面：条越宽说明这个结论越依赖永续增长率这一个假设。
   // 光看条的长短说不清是「区间宽」还是「画得长」，所以把宽度写成数字。
   const widthText = hasBand
    ? `<text x="${plotRight + 12}" y="${y(index) + 15}" class="vs-width">带宽 ${num(high - low, 1)}pp</text>` : '';
   return `<g class="vs-row">
    <text x="${NAME_W - 14}" y="${y(index) + 4}" text-anchor="end" class="vs-name">${esc(row.name || row.code)}</text>
    ${band}
    ${stressLink}
    ${dot}${stressMark}${mark}
    <text x="${plotRight + 12}" y="${y(index) + 2}" class="vs-value ${tone}">${esc(label)}</text>
    ${widthText}
    <title>${esc(row.name || row.code)}（${esc(row.code)}）：${esc(title)}</title>
   </g>`;
  }).join('');

  return `<svg class="vs-chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="各公司安全边际区间与 ${MID_LABEL} 档落点">${safeZone}${ticks.join('')}${zeroLine}${thresholdLine}${body}</svg>`;
 }

 function tableOf(data, slot){
  const rows = rowsOf(data, slot, true);
  if(!rows.length) return '<div class="empty">目前没有能测算的公司。</div>';
  const thr = isNum(data?.margin_min_pct) ? num(Number(data.margin_min_pct), 0) : '未配置';
  const head = '<tr><th>公司</th><th>收盘价 / 日期</th><th>基准 FCFF / 亿元</th><th>五年中位数 / 亿元</th><th>当前口径 WACC</th><th>中性 1% 档每股</th><th>中性 2% 档每股</th><th>中性 3% 档每股</th><th>中性安全边际（' + MID_LABEL + ' 档落点）</th><th>中性 ' + thr + '% 门槛</th><th>终值占企业价值</th><th>报表货币资金未计入</th></tr>';
  const body = rows.map(row => {
   const s = row.scenario || {};
   const wacc = s.wacc || {};
   const mid = scenarioOf(row, MID);
   const forecast = s.forecast || {};
   const per = key => {
    const sc = scenarioOf(row, key);
    if(!isNum(sc.per_share)) return '<span class="muted">—</span>';
    if(sc.valid === false){
     // valid=false 有两种原因：股权价值算出来是负的，或者这档根本没算出来。
     // 两回事，标签不能混。
     const negative = isNum(sc.equity_value) && Number(sc.equity_value) < 0;
     return '<span class="pill warning" title="' + (negative ? '这一档股权价值为负' : '这一档没算出来') + '">'
      + (negative ? '股权为负' : '无法测算') + '</span>';
    }
    return '¥' + num(sc.per_share);
   };
   const neu = neutralOf(row);
   const margin = neu.margin !== null ? '<strong>' + pct1(neu.margin) + '</strong>' : '<span class="muted">—</span>';
   const target = neutralTarget(neu.per, data?.margin_min_pct);
   const targetCell = target === null ? '<span class="muted">—</span>' : '≤ ¥' + num(target);
   const terminal = isNum(mid.terminal_share) ? pct1(mid.terminal_share) : '—';
   const cash = isNum(forecast.cash_not_counted_yi) && forecast.cash_not_counted_yi > 0
    ? num(forecast.cash_not_counted_yi) + ' 亿（每股约 ' + num(forecast.cash_per_share_ignored) + ' 元）'
    : '<span class="muted">未取到</span>';
   const price = isNum(mid.price) ? '¥' + num(mid.price) + ' / ' + esc(mid.price_date || '—') : '<span class="muted">报价不可用</span>';
   return `<tr data-tt-key="${esc(row.code)}">
    <td><button type="button" data-company="${esc(row.code)}" data-forecast-basis="${esc(row.scenario?.forecast?.basis||'median')}">${esc(row.name || row.code)}</button> <span class="code">${esc(row.code)}</span>${row.industry ? ' <span class="muted small">' + esc(row.industry) + '</span>' : ''}</td>
    <td>${price}</td>
    <td>${num(forecast.fcff_yi)}<br><span class="small muted">${forecast.basis==='latest'?esc(forecast.source_year)+' 年':(forecast.basis==='mean'?'五年均值':'五年中位数')}</span></td><td>${num(forecast.five_year_median_yi)}</td>
    <td>${isNum(wacc.wacc_pct) ? num(wacc.wacc_pct) + '%' : '<span class="muted">—</span>'}</td>
    <td>${per('g1%')}</td><td>${per('g2%')}</td><td>${per('g3%')}</td>
    <td>${margin}</td><td>${targetCell}</td><td>${terminal}</td><td>${cash}</td>
   </tr>`;
  }).join('');
  return `<div class="scroll"><table data-tt-sync="${esc(slot||SLOT_MAIN)}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
 }

 function decisionTable(data, slot){
  const threshold = isNum(data?.margin_min_pct) ? Number(data.margin_min_pct) : NaN;
  const validThreshold = Number.isFinite(threshold) && threshold >= 0 && threshold < 100;
  const thrText = validThreshold ? num(threshold, 0) + '%' : '未配置';
  const thrHead = validThreshold ? '中性 ' + num(threshold, 0) + '% 门槛' : '中性门槛（未配置）';
  const body = rowsOf(data, slot, true).map(row => {
   const neu = neutralOf(row);
   const stress = row.scenario.stress || {};
   const complete = stress.complete === true && isNum(stress.low) && isNum(stress.high);
   const stressLow = complete ? Number(stress.low) : null;
   const stressPositive = stressLow !== null && stressLow > 0;
   const target = neutralTarget(neu.per, threshold);
   const stressMargin = stressPositive && neu.comparable ? 1 - neu.price / stressLow : null;
   const condition = neutralCondition(neu, threshold, validThreshold);
   const bandCell = neu.low === null
    ? '<span class="pill warning">三档均无法测算</span>'
    : '¥' + num(neu.low) + ' ～ ¥' + num(neu.high);
   const targetCell = target === null ? '<span class="muted">—</span>' : '≤ ¥' + num(target);
   const marginCell = neu.margin === null ? '<span class="muted">—</span>' : '<strong>' + pct1(neu.margin) + '</strong>';
   const stressCell = complete ? '¥' + num(stress.low) + ' ～ ¥' + num(stress.high) : '<span class="muted">情景不完整</span>';
   const stressMarginCell = stressMargin === null
    ? '<span class="muted">—</span><br><span class="small muted">' + (complete ? '压力下限非正，不适用' : '情景不完整') + '</span>'
    : pct1(stressMargin);
   return `<tr data-tt-key="${esc(row.code)}">
    <td><button type="button" data-company="${esc(row.code)}" data-forecast-basis="${esc(row.scenario.forecast?.basis||'median')}">${esc(row.name||row.code)}</button><br><span class="small muted">自动估值 · 未复核</span></td>
    <td>${isNum(neu.price)?'¥'+num(neu.price):'不可比较'}<br><span class="small muted">${esc(neu.priceDate)}</span></td>
    <td>${bandCell}<br><span class="small muted">中性中枢 ${MID_LABEL} 档 ${neu.per===null?'—':'¥'+num(neu.per)}</span></td>
    <td>${targetCell}</td>
    <td>${marginCell}</td>
    <td>${condition}</td>
    <td>${stressCell}</td>
    <td>${stressMarginCell}</td>
   </tr>`;
  }).join('');
  const intro = `<p class="small muted"><strong>中性情景</strong>＝「大概率能实现的内在价值」：现金流用自动草案原值（不预先假设未来变差 20%），WACC 取当前口径，只对永续增长率取 1% / 2% / 3% 三档敏感性——永续增长率没有官方值，三档并列展示；但主情景取 1%（2026-10-31 已定，保守档），另两档是上行参照。</p>
  <p class="small muted"><strong>价格条件只看中性情景</strong>：中性安全边际 ＝ 1 − 收盘价 ÷ 中性中枢（${MID_LABEL} 档）；${thrHead} ＝ 中性中枢 ×（1 − ${thrText}）。安全边际的作用是抵消我自己预测的误差，不是提前假设「未来一定变差」。</p>
  <p class="small muted"><strong>压力校验区间</strong>（原 24 组机械情景：现金流原值 / 全部低 20%，WACC 当前 / +1 / +2 个百分点，永续增长 0% / 1% / 2% / 3%）保留为辅助观察，不控制价格条件。那是灾难情景，拿它当门槛会把所有公司都判成不合格。</p>
  <p class="small muted"><strong>顺序别弄反</strong>：先做定性筛选——ROIC 持续高于 WACC、有护城河、现金流稳定、杠杆可控（在「严格财务预筛」和「投资核查清单」里），确认是好生意，再谈估值折扣。本页只管价格这一段。</p>`;
  return `<div class="panel"><h3>股价、自动估值与价格门槛</h3>${intro}<div class="scroll"><table data-tt-sync="${esc(slot||SLOT_MAIN)}"><thead><tr><th>公司 / 状态</th><th>当前收盘价 / 日期</th><th>中性情景范围 / 元每股</th><th>${thrHead}</th><th>中性安全边际（主判断）</th><th>价格条件</th><th>压力校验区间（辅助观察）</th><th>相对压力下限的安全边际（辅助）</th></tr></thead><tbody>${body}</tbody></table></div><p class="small muted">门槛随模型假设变化，达到价格条件仍不等于可以买入。待复核：生意是否可预测、一次性项目、维持经营所需资本支出与营运资本、可分配现金、负债与少数股东权益，以及长期增长能否由再投资支持。历史 FCFF 不等于已经核实的股东盈余。</p></div>`;
 }

 function skippedOf(data){
  const skipped = data?.skipped || [];
  if(!skipped.length) return '';
  const rows = skipped.map(item => `<tr><td>${esc(item.code)}</td><td>${esc(item.name || '—')}</td><td>${esc((item.missing || []).join('；'))}</td></tr>`).join('');
  return `<div class="panel"><h3>当前口径暂不能自动测算的 ${skipped.length} 家</h3><p class="small muted">逐家列出数据缺项或模型条件；可切换另一种现金流口径对照。</p><div class="scroll"><table><thead><tr><th>代码</th><th>公司</th><th>原因</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
 }

 function warnings(data){
  const rows = rowsOf(data, SLOT_MAIN, true);
  const dropped = rowsOf(data, SLOT_MAIN).filter(isNegativeEquity).length;
  const terminals = rows.map(r => scenarioOf(r, MID).terminal_share).filter(isNum).map(Number);
  const high = terminals.filter(v => v >= 0.6).length;
  const swings = rows.filter(row => {
   const values = marginPcts(row);
   return values.length > 1 && Math.max(...values) - Math.min(...values) > 20;
  }).length;
  return `<div class="notice vs-notice">
   <p><strong>这是自动估值情景，尚未研究复核。</strong>本页采用${data.forecast_basis==='latest'?'最近一年 FCFF 平推五年（零显性增长）。这是假设单年现金流水平持续，尚未剔除一次性项目，也未证明已进入稳定期；请切换五年中位数对照':(data.forecast_basis==='mean'?'最近五年 FCFF 均值平推五年（包括全部负值年份，受极端年份影响）':'最近五年 FCFF 中位数平推五年（零显性增长）')}，永续增长率取 1%/2%/3% 三档——没有任何官方值，所以三档并列展示；主情景取 1%（2026-10-31 已定）。这三档是中性情景：现金流用原值，不预先假设未来变差。测算结果不写入估值存档，也不进最终候选。</p>
   <p><strong>判断顺序：先筛生意，再谈折扣。</strong>定性筛选（ROIC 持续高于 WACC、有护城河、现金流稳定、杠杆可控）在「严格财务预筛」和「投资核查清单」里；本页只负责价格这一段——先用中性情景估出「大概率能实现的内在价值」，再在它上面打安全边际折扣，让折扣去抵消我自己的预测误差。</p>
   <p><strong>DCF 股权价值为负的直接剔除。</strong>企业价值连有息债务与少数股东权益都覆盖不了，就谈不上持续创造超额收益——这类标的不进主表、不参与排序、不参与价格判断。${dropped?`本轮剔除了 ${dropped} 家，剔的是谁、剔的理由、以及漏算了多少现金，都列在下面的清单里，可以自己复核。`:'本轮没有出现股权价值为负的标的。'}</p>
   <p>${high} / ${rows.length} 家的终值占企业价值 60% 以上，${swings} 家在三档之间安全边际摆动超过 20 个百分点：这两个数说明结果对假设的依赖程度，请把它当排序参考，不是买入结论。</p>
   <p>报表货币资金暂按 0 计（尚未辨别可分配现金），下表写明各家漏算了多少；债务用账面值代替市值，非经营性现金以外的资产也未加回。报价过期时不比安全边际，宁可不比也不拿旧价凑数。</p>
  </div>`;
 }

 // 被剔除的标的单独列一节：判断层剔掉了，但剔的依据必须摊开给人看。
 function droppedPanel(dropped){
  if(!dropped.length) return '';
  const body = dropped.map(row => {
   const scen = scenarioOf(row, MID);
   const cash = cashAdjusted(row);
   const equity = isNum(scen.equity_value) ? num(Number(scen.equity_value) / 1e8, 4) + ' 亿' : '—';
   const cashCell = cash ? num(cash.cashYi) + ' 亿（每股约 ' + num(cash.perShareIgnored) + ' 元）' : '<span class="muted">未取到</span>';
   const withCash = cash ? num(cash.equityWithCashYi, 4) + ' 亿（每股 ' + num(cash.perShare, 4) + ' 元）' : '<span class="muted">数据不全</span>';
   return `<tr>
    <td><button type="button" data-company="${esc(row.code)}">${esc(row.name||row.code)}</button> <span class="code">${esc(row.code)}</span></td>
    <td>${equity}</td>
    <td>${cashCell}<br>${negativeEquityNote(row)}</td>
    <td>${withCash}</td>
    <td>${isNum(scen.price)?'¥'+num(scen.price):'—'}</td>
    <td class="small">DCF 股权价值为负：企业价值覆盖不了有息债务与少数股东权益，谈不上持续创造超额收益</td>
   </tr>`;
  }).join('');
  return `<div class="panel"><h3>DCF 股权价值为负 · 已剔除 ${dropped.length} 家</h3>
   <p class="small muted">这几家在中性情景三档（永续增长率 1%/2%/3%）下的股权价值都是负的，已从上面的主表与区间图里去掉，不参与排序与价格判断。判定用的是自动草案口径（报表货币资金按 0 计）；下面同时补上漏算的现金与收盘价，方便自己复核这个剔除站不站得住。</p>
   <div class="scroll"><table><thead><tr><th>公司</th><th>中性 ${MID_LABEL} 档股权价值</th><th>报表货币资金未计入</th><th>若计入现金</th><th>收盘价</th><th>剔除理由</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
 }

 function render(data){
  last = data || null;
  const views=data?.views;
  const coverage=selectedBasis==='coverage'&&Array.isArray(data?.supplementary_rows);
  const basis=coverage?'coverage':(views?.[selectedBasis]?selectedBasis:'median');
  const supplementary=coverage?data.supplementary_rows:[];
  const count=(views?.median?.rows?.length||0)+(data?.supplementary_rows?.length||0);
  const switches=views?`<div class="panel"><h3>现金流测算口径</h3><div class="actions">${[['coverage','全部结果 · 分口径',count],['median','五年中位数',views.median?.rows?.length||0],['mean','五年均值',views.mean?.rows?.length||0],['latest','最近一年情景',views.latest?.rows?.length||0]].map(([key,label,n])=>`<button type="button" data-scenario-basis="${key}" aria-pressed="${basis===key}">${label}（${n} 家）</button>`).join('')}</div><p class="small muted">全部结果保留五年中位数排名；中位数不满足条件时，依次补充五年均值、最近一年情景，并单列展示，不混入原排名。均值包含全部负值年份，不删除亏损年度、不挑最高估值。也可切换为所有公司使用同一口径。</p></div>`:'';
  data=coverage?{...data,skipped:data.coverage_skipped||[],forecast_basis:'median'}:(views?.[basis]?{...data,...views[basis],forecast_basis:basis}:data);
  const rows = rowsOf(data, SLOT_MAIN, true);
  const dropped = rowsOf(data, SLOT_MAIN).filter(isNegativeEquity);
  const supplementaryKept = supplementary.filter(row => !isNegativeEquity(row));
  const supplementaryDropped = supplementary.filter(isNegativeEquity);
  const allDropped = dropped.concat(supplementaryDropped);
  const threshold = Number(data?.margin_min_pct) || 0;
  const passed = rows.filter(row => meetsThreshold(scenarioOf(row, MID).margin, threshold)).length;
  const generated = data?.generated_at ? String(data.generated_at).replace('T', ' ').slice(0, 16) : '—';
  return `
  ${switches}
  ${warnings(data)}
  ${decisionTable(data, SLOT_MAIN)}
  ${droppedPanel(allDropped)}
  <div class="stats">
   <div class="stat"><span class="muted">已生成测算</span><strong>${rows.length+supplementaryKept.length}</strong><span class="small">家${coverage?' · 五年中位数 '+rows.length+' 家，补充 '+supplementaryKept.length+' 家':'（当前统一口径）'}${allDropped.length?' · 已剔除 '+allDropped.length+' 家':''}</span></div>
   <div class="stat"><span class="muted">${coverage?'五年中位数 · ':''}中性达标（${MID_LABEL} 档）</span><strong>${passed}</strong><span class="small">家 · 中性安全边际 ≥ ${threshold}%</span></div>
   <div class="stat"><span class="muted">需补资料或单独建模</span><strong>${(data?.skipped || []).length}</strong><span class="small">家 · 原因已列明</span></div>
   <div class="stat"><span class="muted">DCF 股权价值为负</span><strong>${allDropped.length}</strong><span class="small">家 · 已剔除，不参与排序与价格判断</span></div>
  </div>
  <div class="panel">
   <div class="vs-chart-head">
    <div><h3>中性情景安全边际区间与落点</h3><p class="small muted">横轴是安全边际（现价相对中性情景估值折了多少）。每条横带的<strong>左端是永续增长率 1% 档、右端是 3% 档</strong>，圆点是 ${MID_LABEL} 档落点；数值下面那行<strong>带宽</strong>＝三档之间安全边际的摆动幅度，越宽说明这个结论越依赖永续增长率这一个假设。竖虚线是 ${threshold}% 中性门槛，竖实线是 0 轴：<strong>区间跨过 0 轴的，说明换个假设「贵」就变成「便宜」，这类最需要警惕</strong>。带的颜色按 ${MID_LABEL} 档落点分：绿＝已达门槛，橙＝在 0 与门槛之间，灰＝落点为负。细竖线是压力校验下限折算后的位置，淡虚线把它连到中性带左端——那一段就是中性结论离灾难情景还有多远；只作辅助观察，不控制价格条件。</p></div>
    <div class="vs-legend"><span><i class="vs-key vs-key-band"></i>中性三档区间</span><span><i class="vs-key vs-key-dot"></i>${MID_LABEL} 档落点</span><span><i class="vs-key vs-key-threshold"></i>${threshold}% 中性门槛</span><span><i class="vs-key vs-key-safe"></i>达标段</span><span><i class="vs-key vs-key-stress"></i>压力校验下限</span></div>
   </div>
   <div class="vs-chart-wrap">${bandChart(data)}</div>
   <p class="small muted">横轴范围 ${axisDomain(data).lo}% ～ ${axisDomain(data).hi}%；低于左端的区间折叠到边缘并标 ◀，确切数字见下表。压力校验下限折到左端（虚线）表示它远在坐标轴之外，那一档本来就不参与价格判断。</p>
   <p class="small muted"><strong>带宽为什么有的宽有的窄</strong>——由三件事共同决定（实测三因素合起来对带宽的解释力约 0.76）：①<strong>终值占企业价值的比重</strong>，永续增长率只影响终值，比重越高越敏感（本页 70%～88%）；②<strong>WACC 与永续增长率的间距</strong>，终值 ∝ 1÷(WACC−g)，WACC 越低、g 越靠近它，同样挪 2 个百分点，估值变动越大（法拉电子 WACC 9.13% 时终值只涨 35%，华润江中 WACC 4.56% 时涨 109%）；③<strong>落点离 0 的距离</strong>，安全边际 ＝ 1 − 市值÷企业价值，落点接近 0 时，企业价值的相对变化几乎 1:1 映射到安全边际，条自然更宽。</p>
   <p class="small muted"><strong>带宽怎么用</strong>：条窄、且整条都在门槛右侧，说明三档假设下都达标，结论稳；条宽、并跨过 0 轴，说明「贵还是便宜」取决于永续增长率取 1% 还是 3%，这类不该按单一落点下判断。</p>
  </div>
  <div class="panel">
   <h3>逐家测算结果</h3>
   <p class="small muted">每股情景估值来自自动草案 + 当前口径 WACC；报价取最近一个交易日的未复权收盘价（每个交易日 16:30 后自动更新）。表中 1%/2%/3% 档每股与安全边际都是中性情景口径（现金流用原值，只有永续增长率在变）；「中性 ${threshold}% 门槛」＝ ${MID_LABEL} 档每股 ×（1 − ${threshold}%）。测算时间 ${esc(generated)}。</p>
   ${tableOf(data, SLOT_MAIN)}
  </div>
  ${supplementary.length?`<div class="panel"><h3>补充测算 · ${supplementary.length} 家</h3><p class="small muted">以下公司五年中位数不满足条件，采用表内注明的替代口径。五年均值会受并购、扩产和营运资本波动影响；单年情景假设近期现金流水平持续，尚未证明进入稳定期。补充结果不混入上方排名，也不自动进入最终候选。</p>${supplementary.map(row=>`<p class="small muted"><strong>${esc(row.name)}</strong>：${esc((row.primary_missing||[]).join('；'))}；补充采用 ${esc(row.scenario.forecast.method)}。</p>`).join('')}${decisionTable({...data,rows:supplementary}, SLOT_SUPP)}${tableOf({...data,rows:supplementary}, SLOT_SUPP)}</div>`:''}
  ${skippedOf(data)}`;
 }

 function renderCharts(){ /* SVG 图不需要 ECharts 实例，重新渲染即可 */ }

 function resizeCharts(){ renderCharts(); }

 return {render, renderCharts, resizeCharts, selectBasis, applyOrder, currentBasis:()=>selectedBasis};
})();
