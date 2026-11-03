'use strict';

// 批量测算视图：三档情景下的每股内在价值与安全边际。
//
// 自动估值尚未经研究复核：主口径是经营驱动预测，逐年预测收入、EBIT、NOPAT、
// 折旧、资本开支和营运资本，再重建 FCFF；历史 FCFF 平推只保留为诊断对照。
// 结果不写入估值存档，也不进最终候选。
//
// 口径分两步（巴菲特式）：
// 1. 先做「保守机械估值」 = 主情景：现金流用自动草案原值
//    （不预先假设未来变差 20%），WACC 取当前口径，只对永续增长率取三档。
//    主情景就是永续增长率 1% 档（2026-10-31 已定），另两档是上行参照。
// 2. 再在主情景内在价值上打安全边际折扣（20%）。折扣的作用是抵消我自己
//    预测的误差，不是提前假设「未来一定变差」。
//    价格条件 = 1 − 收盘价 ÷ 主情景内在价值 ≥ 门槛（折价口径）。
//
// 股权桥用「严格口径」：账上货币资金与交易性金融资产不进股权桥，只扣有息
// 负债与少数股东权益。这是有意从严的筛法——宁缺毋滥，宁可漏掉好公司，也
// 不多放进一家。未计入的现金逐家列在表里，还给出「若计入现金后」的安全
// 边际，让读者自己判断这个从严是否合适；判断层仍用严格口径，不因披露而
// 放宽。
//
// 三条硬规矩（和市场情绪、周期那页一致）：
// 1. 数字只有一种来源：服务器算好的真实读数。缺数据写「缺什么」，不拿示例值顶替。
// 2. 区间和阈值必须画成图，并且标出落点——三档永续增长率本身就是一条区间，
//    所以每家画一条区间带，落点标已定档（1%），再把价格条件线和 0 轴画出来。
// 3. 颜色与宽度一律走 CSS 类或 CSSOM 赋值：服务器 CSP 是 style-src 'self'，
//    行内 style 属性会被浏览器静默忽略（这个坑本项目已经踩过三次）。
window.ValuationScenarios = (() => {
 const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num = (x, n=2) => x === null || x === undefined || x === '' ? '—' : Number(x).toLocaleString('zh-CN', {maximumFractionDigits:n, minimumFractionDigits:n});
 const isNum = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
 const pct1 = x => isNum(x) ? num(Number(x) * 100, 1) + '%' : '—';
 const KEYS = ['g1%','g2%','g3%'];
 // 主情景档 = 用户 2026-10-31 拍板取的那一档（永续增长率 1%，保守档）。
 // 展示层仍给全量：1%/2%/3% 三档全画出来、带子全量展示；
 // 判断层只用已定的那一档——一个数只干一件事，别让页面留两套价格条件。
 const MID = 'g1%';
 const MID_LABEL = '1%';
 const AXIS_MIN = -100;   // 横轴左端：低于这个值的区间折叠到边缘并标记 ◀
 const AXIS_MAX = 90;     // 横轴右端

 let last = null;
 let selectedBasis = 'conservative';
 // 打开存档表单的公司代码：存档在批量测算这一页完成，不再进二级页面。
 let saveCode = null;
 // 表格排序与区间图共用一套行顺序：用户在表里排完，图就按同一个顺序重画，
 // 否则「图上一家、表里另一家」会让人以为两处算的不是一回事。
 const SLOT_MAIN = 'scenarios:main';
 const SLOT_SUPP = 'scenarios:supp';
 const orderSlots = new Map();
 function applyOrder(slot, keys){ if(slot) orderSlots.set(slot, (keys||[]).slice()); }
 function selectBasis(value){if(['conservative','coverage','operating','latest','median','mean'].includes(value))selectedBasis=value;}

 const scenarioOf = (row, key) => (((row || {}).scenario || {}).scenarios || {})[key] || {};
 const margins = row => KEYS.map(k => scenarioOf(row, k).margin).filter(isNum).map(Number);
 // 安全边际在数据里是小数（0.668），门槛是百分数（30）。图上的横轴是百分数，
 // 所以画图前一律换成百分点再比、 再定位——把小数直接当百分点会整体错位。
 const marginPcts = row => margins(row).map(v => v * 100);
 const meetsThreshold = (margin, threshold) => isNum(margin) && Number(margin) * 100 >= threshold;
 const valuationGate = row => ((row || {}).scenario || {}).valuation_quality_gate || {};
 const researchReady = row => valuationGate(row).ready === true;
 const gateBlockers = row => (valuationGate(row).blockers || []).filter(Boolean);
 const marginIsDistorted = margin => isNum(margin) && Number(margin) <= -10;
 const marginDisplay = (margin, strong=false) => {
  if(!isNum(margin)) return '<span class="muted">—</span>';
  if(marginIsDistorted(margin)) return '<span class="pill warning">内在价值接近零，百分比失真</span>';
  return strong ? '<strong>' + pct1(margin) + '</strong>' : pct1(margin);
 };
 const terminalRisk = share => {
  if(!isNum(share)) return '<span class="muted">—</span>';
  const value=Number(share);
  if(value>=0.6) return `${pct1(value)}<br><span class="pill warning">高依赖·需重点复核</span>`;
  if(value>=0.4) return `${pct1(value)}<br><span class="pill gray">中等依赖</span>`;
  return `${pct1(value)}<br><span class="pill">低依赖</span>`;
 };

 // ── 三档情景（主判断口径 + 上行参照）───────────────────────────────────────
 // 三档情景 = 现金流用自动草案原值 + 当前口径 WACC，只对永续增长率取三档。
 // 1% 档是主情景（判断层），2%/3% 档是上行参照（只看换一个假设会怎样）。
 function scenarioBand(row){
  const values = KEYS.map(k => scenarioOf(row, k))
   .filter(s => s.valid !== false && isNum(s.per_share) && Number(s.per_share) > 0)
   .map(s => Number(s.per_share));
  return {low: values.length ? Math.min(...values) : null, high: values.length ? Math.max(...values) : null};
 }
 // 主情景取已定档（1%）：永续增长率没有官方值，但用户 2026-10-31 已拍板取保守档 1%。
 // 三档仍然并列展示（看换一个假设会怎样），判断层只用已定的那一档。
 function mainOf(row){
  const scen = scenarioOf(row, MID);
  const per = (scen.valid !== false && isNum(scen.per_share) && Number(scen.per_share) > 0) ? Number(scen.per_share) : null;
  const price = isNum(scen.price) ? Number(scen.price) : null;
  // 报价过期、跨源不一致、停牌时服务端根本不填 price，宁可不比也不拿旧价凑数。
  // 股权为负时 compare_state 会被改成 invalid，但 per 为 null，同样不可比。
  const comparable = per !== null && price !== null;
  const margin = comparable ? (isNum(scen.margin) ? Number(scen.margin) : 1 - price / per) : null;
  const band = scenarioBand(row);
  return {scen, per, price, comparable, margin, low: band.low, high: band.high,
          priceDate: scen.price_date || '—', reason: scen.compare_reason || ''};
 }
 // 价格条件 = 主情景内在价值 ×（1 − 门槛）。折扣只作用在这里，不作用在现金流上。
 const priceCondition = (per, threshold) => (per === null || !isNum(threshold)) ? null : per * (1 - Number(threshold) / 100);
 // 价格条件只看主情景；压力情景不参与这个判断。
 // 真「股权价值为负」的标的已经在 rowsOf 里剔除了，进到这里只可能是「算不出来」，
 // 所以这里写「无法测算」，不能再写「股权价值为负」——那是另一种情况。
 function priceConditionText(row, neu, threshold, validThreshold){
  if(neu.per === null){
   return neu.low === null
    ? '三档均无法测算，不参与价格判断'
    : `主情景档（${MID_LABEL}）无法测算，不参与价格判断（另两档仍有正估值）`;
  }
  if(!validThreshold) return '请配置安全边际门槛';
  if(!neu.comparable) return '报价不可比较' + (neu.reason ? '：' + neu.reason : '');
  const target = priceCondition(neu.per, threshold);
  if(neu.price > target) return '尚未达到价格条件（未达 ' + num(threshold, 0) + '% 安全边际）';
  if(researchReady(row)) return '达到价格条件，且预测/估值门禁已通过';
  const blockers = gateBlockers(row);
  return '达到价格条件，但预测/估值门禁未通过'
   + (blockers.length ? '：' + blockers.join('；') : '');
 }
 // 严格口径：账上现金不进股权桥。「股权价值为负」必须带上这个假设，
 // 否则会被读成公司资不抵债——实际可能只是没给账上的现金估值。
 // 这里算出「若把货币资金计入」的每股与安全边际，让读者自己判断这个从严是否合适；
 // 判断层仍用严格口径，披露不等于放宽。
 function cashAdjusted(row){
  const forecast = (row.scenario||{}).forecast || {};
  if(forecast.basis === 'operating') return null; // 经营口径已把报表现金纳入股权桥，不能重复加。
  const cashYi = isNum(forecast.cash_not_counted_yi) ? Number(forecast.cash_not_counted_yi) : null;
  const scen = scenarioOf(row, MID);
  const equity = isNum(scen.equity_value) ? Number(scen.equity_value) : null;
  const sharesYi = isNum(forecast.shares_yi) ? Number(forecast.shares_yi) : null;
  if(cashYi === null || cashYi <= 0 || equity === null || !sharesYi || sharesYi <= 0) return null;
  const withCash = equity + cashYi * 1e8;
  const perShare = withCash / (sharesYi * 1e8);
  const price = isNum(scen.price) ? Number(scen.price) : null;
  const marginWithCash = (price !== null && price > 0 && perShare > 0) ? 1 - price / perShare : null;
  return {cashYi, equityYi: equity / 1e8, equityWithCashYi: withCash / 1e8,
          perShare, marginWithCash,
          perShareIgnored: isNum(forecast.cash_per_share_ignored) ? Number(forecast.cash_per_share_ignored) : null};
 }
 // 负股权那一格的说明：说清「严格口径」这个假设，剔不剔得由人自己复核。
 function negativeEquityNote(row){
  const cash = cashAdjusted(row);
  if(!cash) return '<span class="small muted">严格口径的货币资金或总股本数据不全，无法核对</span>';
  return `<span class="small muted">严格口径：账上货币资金 ${num(cash.cashYi)} 亿未计入股权桥</span>`;
 }

 // ── DCF 股权价值为负 → 直接剔除 ─────────────────────────────────────────────
// DCF 算出股权价值为负，说明企业价值连有息债务与少数股东权益都覆盖不了，
// 谈不上持续创造超额收益，这类标的直接剔除，不进主表、不参与排序。
//
// 判定口径：三档（永续增长率 1%/2%/3%）股权价值**全为负**才算命中——
// 某一档算不出来、或某一档为正，都不叫「股权价值为负」。
// 剔除用的是严格口径（账上现金不计入股权桥）；被剔的公司会在清单里写明
// 未计入的现金、计入后是什么数，便于自己复核这个剔除站不站得住。
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
  const thresholdLine = `<line x1="${x(threshold).toFixed(1)}" y1="${TOP - 12}" x2="${x(threshold).toFixed(1)}" y2="${height - BOTTOM + 4}" class="vs-threshold"/><text x="${x(threshold).toFixed(1)}" y="${TOP - 18}" text-anchor="middle" class="vs-threshold-label">${threshold}% 价格条件线</text>`;

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
   const tone = midPct === null ? 'negative' : (midPct >= threshold ? (researchReady(row) ? 'positive' : 'unverified') : (midPct >= 0 ? 'thin' : 'negative'));
   const x1 = x(low), x2 = x(high);
   // 压力校验下限（辅助观察）：把「按压力下限还剩多少安全边际」折算到同一条轴上，
   // 落点必然在三档带左侧；超出坐标轴时折到左端并改用虚线。
   const stress = row.scenario.stress || {};
   const stressLow = stress.complete === true && isNum(stress.low) && Number(stress.low) > 0 ? Number(stress.low) : null;
   const stressPct = (stressLow !== null && isNum(midScenario.price)) ? (1 - Number(midScenario.price) / stressLow) * 100 : null;
   const stressX = stressPct === null ? null : x(stressPct);
   // 从压力下限连一条淡虚线到三档带左端：这一段就是「主情景离灾难情景还有多远」。
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
        return cash ? `；严格口径：账上货币资金 ${num(cash.cashYi)} 亿未计入股权桥，计入后 ${MID_LABEL} 档每股 ${num(cash.perShare)} 元、安全边际 ${pct1(cash.marginWithCash)}` : ''; })() : '');
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
  const bridgeHead = data?.forecast_basis === 'operating' ? '股权桥' : '严格口径：账上现金未计入；若计入现金后的安全边际';
  const head = '<tr><th>公司</th><th>收盘价 / 日期</th><th>经营驱动预测</th><th>当前口径 WACC</th><th>主情景 1% 档每股</th><th>上行参照 2% 档每股</th><th>上行参照 3% 档每股</th><th>主情景安全边际（' + MID_LABEL + ' 档落点）</th><th>价格条件线 ' + thr + '%</th><th>终值占企业价值</th><th>' + bridgeHead + '</th></tr>';
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
   const neu = mainOf(row);
   const margin = marginDisplay(neu.margin, true);
   const target = priceCondition(neu.per, data?.margin_min_pct);
   const targetCell = target === null ? '<span class="muted">—</span>' : '≤ ¥' + num(target);
   const terminal = terminalRisk(mid.terminal_share);
   const cash = cashAdjusted(row);
   const cashCell = cash
    ? num(cash.cashYi) + ' 亿（每股约 ' + num(cash.perShareIgnored) + ' 元）'
    : '<span class="muted">未取到</span>';
   const cashMarginCell = cash && cash.marginWithCash !== null
    ? pct1(cash.marginWithCash) + '<br><span class="small muted">仅作披露，不改判断</span>'
    : '<span class="muted">—</span>';
   const price = isNum(mid.price) ? '¥' + num(mid.price) + ' / ' + esc(mid.price_date || '—') : '<span class="muted">报价不可用</span>';
   const drivers = operatingForecastTable(s);
   const bridge = forecast.basis === 'operating'
    ? `现金 ${num(forecast.cash_assumed_yi)} 亿<br><span class="small muted">加交易性金融资产，减有息负债、少数股东权益及优先索取权</span>`
    : `${cashCell}<br>${cashMarginCell}`;
   return `<tr data-tt-key="${esc(row.code)}">
    <td><button type="button" data-company="${esc(row.code)}">${esc(row.name || row.code)}</button> <span class="code">${esc(row.code)}</span>${row.industry ? ' <span class="muted small">' + esc(row.industry) + '</span>' : ''}${jumpTag(row)}</td>
    <td>${price}</td>
    <td>${drivers}</td>
    <td>${isNum(wacc.wacc_pct) ? num(wacc.wacc_pct) + '%' : '<span class="muted">—</span>'}</td>
    <td>${per('g1%')}</td><td>${per('g2%')}</td><td>${per('g3%')}</td>
    <td>${margin}</td><td>${targetCell}</td><td>${terminal}</td><td>${bridge}</td>
   </tr>`;
  }).join('');
  return `<div class="scroll"><table data-tt-sync="${esc(slot||SLOT_MAIN)}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
 }

 function operatingForecastTable(scenario){
  const forecast = scenario.forecast || scenario;
  const rows = forecast.rows || [];
  if(forecast.basis !== 'operating' || !rows.length){
   const label = forecast.basis === 'latest' ? `${esc(forecast.source_year)} 年` :
    (forecast.basis === 'mean' ? '五年均值' : '五年中位数');
   const medianNote = isNum(forecast.five_year_median_yi) ? `；五年中位数 ${num(forecast.five_year_median_yi)} 亿` : '';
   return `${num(forecast.fcff_yi)} 亿<br><span class="small muted">${label}${medianNote}；${esc(forecast.method||'历史 FCFF 诊断对照')}</span>`;
  }
  const body = rows.map(r => `<tr><td>${esc(r.year)}</td><td>${num(r.revenue/1e8)}</td><td>${num(r.revenue_growth_pct,1)}%</td><td>${num(r.ebit/1e8)}</td><td>${num(r.nopat/1e8)}</td><td>${num(r.depreciation/1e8)}</td><td>${num(r.capex/1e8)}</td><td>${num(r.change_nwc/1e8)}</td><td><strong>${num(r.fcff/1e8)}</strong></td></tr>`).join('');
  const lineage = forecast.data_lineage || {};
  const anomaly = forecast.anomalies || {};
  const template = forecast.industry_template || {};
  const backtest = forecast.backtest || {};
  const empirical = forecast.empirical_interval || {};
  const reliability = forecast.reliability || {};
  const decisionGate = forecast.decision_gate || {};
  const normalization = forecast.normalization || {};
  const capital = forecast.capital_allocation || {};
  const segmentPlan = forecast.segment_plan || {};
  const reverse = scenario.reverse_dcf || {};
  const riskGate = scenario.risk_gate || {};
  const riskLinks = forecast.risk_driver_linkage || scenario.risk_driver_linkage || {};
  const lineageRows = (lineage.items||[]).map(item=>`<li><strong>${esc(item.label||item.key)}</strong> · ${item.kind==='reported'?'财报披露':item.kind==='assumption'?'预测假设':'财报计算'} · ${esc(item.source||'')}</li>`).join('');
  const abnormalYears = (anomaly.years||[]).filter(item=>item.anomalous);
  const anomalyRows = abnormalYears.map(item=>`<li><strong>${esc(item.year)}</strong>：${esc((item.reasons||[]).join('；'))}</li>`).join('');
  const driverRows = (template.drivers||[]).map(item=>`<li><strong>${esc(item.name)}</strong>：${esc(item.evidence_needed)}</li>`).join('');
  const reverseText = reverse.ready
   ? `${esc(reverse.plain_language)}<br><span class="small muted">匹配现价 ¥${num(reverse.matched_price)}；隐含五年现金流尺度年化变化 ${num(reverse.implied_five_year_cagr_pct,1)}%。</span>`
   : `<span class="muted">${esc((reverse.missing||['暂不能反推']).join('；'))}</span>`;
  const backtestText = backtest.ready
   ? `收入 MAPE ${num(backtest.summary?.revenue_mape_pct,1)}%，EBIT MAPE ${num(backtest.summary?.ebit_mape_pct,1)}%，共 ${esc(backtest.summary?.window_count)} 个历史窗口。${backtest.strict_point_in_time?'已具备严格时点回测版本。':`尚非严格时点回测：${esc(backtest.vintage_limitation||'缺少逐截止日原始版本')}`}`
   : esc((backtest.missing||['历史长度不足']).join('；'));
  const empiricalText = empirical.ready
   ? `<p>${esc(empirical.plain_language||'')}</p><p class="small muted">校准样本：${esc(empirical.calibration?.window_count)} 个窗口、${esc(empirical.calibration?.cutoff_count)} 个独立截止年。</p><div class="scroll"><table><thead><tr><th>区间</th><th>首年收入</th><th>首年 EBIT</th><th>末年收入</th><th>末年 EBIT</th></tr></thead><tbody>${(empirical.bands||[]).map(b=>{const first=(b.forecast||[])[0]||{},last=(b.forecast||[]).slice(-1)[0]||{};return `<tr><td>${esc(b.label)}</td><td>${num(first.revenue/1e8)}</td><td>${num(first.ebit/1e8)}</td><td>${num(last.revenue/1e8)}</td><td>${num(last.ebit/1e8)}</td></tr>`}).join('')}</tbody></table></div>`
   : `<p class="small muted">${esc((empirical.missing||['历史时点回测样本不足，拒绝生成概率带']).join('；'))}</p>`;
  const normalizationText = normalization.ready
   ? `扣非差额需复核年份：${esc((normalization.flagged_years||[]).join('、')||'无达到 15% 阈值的年份')}。${esc(normalization.treatment||'')}`
   : '扣非净利润数据不足，不能量化一次性项目差额。';
  const capitalText = capital.ready
   ? `<p>已观察 ${esc(capital.summary?.observed_years)} 年，其中 ${esc(capital.summary?.covered_years)} 年现金分红由“经营现金流－资本开支”覆盖；融资警示年份：${esc((capital.summary?.financing_warning_years||[]).join('、')||'无')}。</p><div class="scroll"><table><thead><tr><th>年</th><th>自由现金流</th><th>现金分红</th><th>覆盖倍数</th><th>现金变化</th><th>有息债务变化</th><th>ROIC</th></tr></thead><tbody>${(capital.years||[]).slice(-10).map(r=>`<tr><td>${esc(r.year)}</td><td>${isNum(r.owner_fcf)?num(r.owner_fcf/1e8):'—'}</td><td>${isNum(r.dividends)?num(r.dividends/1e8):'—'}</td><td>${isNum(r.dividend_coverage)?num(r.dividend_coverage,2):'—'}</td><td>${isNum(r.cash_change)?num(r.cash_change/1e8):'—'}</td><td>${isNum(r.debt_change)?num(r.debt_change/1e8):'—'}</td><td>${isNum(r.roic_pct)?`${num(r.roic_pct,1)}%`:'—'}${r.financing_warning?' · 警示':''}</td></tr>`).join('')}</tbody></table></div><p class="small muted">金额单位：亿元。${esc(capital.scope_limit||'')}</p>`
   : `<p class="small muted">${esc((capital.missing||['资本配置历史不足']).join('；'))}</p>`;
  const segmentText = segmentPlan.ready
   ? `已选择互斥维度“${esc(segmentPlan.selected_dimension||'未注明')}”，取得 ${esc((segmentPlan.segments||[]).length)} 个分部的数值历史；产品、行业、地区不会重复相加。${segmentPlan.profit_bridge?.basis==='corporate_operating_burden'?` EBIT 桥：分部毛利率扣除公司历史经营费用负担率 ${num(segmentPlan.profit_bridge.burden_to_revenue_pct,1)}%。`:'使用年报披露的分部 EBIT 利润率。'}`
   : esc((segmentPlan.missing||['缺少分部历年数值']).join('；'));
  const riskText = riskGate.paused
   ? `<strong>重大风险暂停：</strong>${esc((riskGate.reasons||[]).join('；'))}`
   : `重大风险暂停：未发现“已核实、重大且尚未解决”的自动暂停事项。搜索线索本身不会被当作事实。`;
  const riskLinkText = (riskLinks.links||[]).length
   ? `<ul>${riskLinks.links.map(item=>`<li><strong>${esc(item.title)}</strong> → ${esc((item.drivers||[]).join('、'))}；${esc(item.meaning)}；${item.can_change_forecast?'已核实重大事项，需人工设置情景':'仅核证或线索，不改变预测'}</li>`).join('')}</ul><p class="small muted">${esc(riskLinks.rule||'')}</p>`
   : '<p class="small muted">暂无可映射的已收集风险证据；这不代表不存在风险。</p>';
  return `<details><summary>查看 5 年经营预测与验证 · 可信度 ${esc(reliability.grade||'—')} / ${num(reliability.score,1)}</summary><p><strong>${esc(reliability.decision||'尚未评级')}</strong></p><p><strong>投资判断门禁：${decisionGate.ready?'已通过':'未通过'}</strong>${decisionGate.ready?'':`；${esc((decisionGate.blockers||[]).join('；'))}`}</p>${(reliability.reasons||[]).length?`<ul>${reliability.reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}<div class="scroll"><table><thead><tr><th>年</th><th>收入</th><th>增长</th><th>EBIT</th><th>NOPAT</th><th>折旧</th><th>资本开支</th><th>营运资本增量</th><th>FCFF</th></tr></thead><tbody>${body}</tbody></table></div><p class="small muted">金额单位：亿元。${esc(forecast.method||'')}</p>
   <h5>反向 DCF · 当前价格要求什么</h5><p>${reverseText}</p>
   <h5>历史滚动回测</h5><p>${backtestText}</p>
   <h5>历史误差概率带 · P10 / P50 / P90</h5>${empiricalText}
   <h5>正常化利润复核</h5><p>${normalizationText}</p>
   <h5>资本配置复盘</h5>${capitalText}
   <h5>分部经营预测</h5><p>${segmentText}</p>
   <h5>重大风险暂停</h5><p>${riskText}</p>
   <h5>风险到经营驱动</h5>${riskLinkText}
   <h5>异常年份</h5>${anomalyRows?`<ul>${anomalyRows}</ul>`:'<p class="small muted">稳健统计未发现显著异常；这不等于不存在会计或经营异常。</p>'}
   <h5>行业经营驱动 · ${esc(template.template||'通用')}</h5><p class="small muted">${esc(template.message||'')}</p><ul>${driverRows}</ul>
   <h5>数据血缘 · 可信度 ${num(lineage.confidence_score,1)} / 100</h5><ul>${lineageRows}</ul>
  </details>`;
 }

 // ── 存为我的基准情景 ──────────────────────────────────────────────────
 // 自动测算是「工具算的」，存档是「我的判断」，两者写在同一页：默认值就是
 // 这一行的自动测算值——不改任何输入直接提交，存档后的每股价值与表里这一行
 // 逐位相同；要改的是现金流与股权桥，那正是自动口径替你做了取舍的地方
 // （尤其是「账上现金算不算数」）。
 const nval = (x, n=4) => isNum(x) ? Number(x).toFixed(n) : '';
 const savedOf = row => isNum(row.saved_per_share) ? Number(row.saved_per_share) : null;

 function saveCell(row){
  const saved = savedOf(row);
  if(saved !== null){
   return `<span class="pill">已存档 ¥${num(saved)}</span><br><button type="button" data-save-code="${esc(row.code)}">查看 / 修改</button>`;
  }
  if(row.save_ready){
   return `<button type="button" data-save-code="${esc(row.code)}">存为我的基准情景</button>`;
  }
  return `<span class="muted small">${esc(row.save_block||'需先完成逐家公司审核并明确保留')}</span>`;
 }

 function saveBasis(row){
  const w = (row.scenario && row.scenario.wacc) || {};
  const f = (row.scenario && row.scenario.forecast) || {};
  const bits = [`现金流：${f.method||'自动草案'}`];
  if(isNum(w.wacc_pct)){
   bits.push(`WACC ${num(w.wacc_pct,4)}%（β ${num(w.beta,4)} ${esc(w.beta_window||'')}／Rf ${num(w.risk_free_pct)}%／股权溢价 ${num(w.premium_pct)}%／税前债务成本 ${num(w.debt_cost_pct)}%／税率 ${num(w.tax_pct)}%）`);
  }
  bits.push('永续增长率 1%');
  bits.push('股权桥按严格口径：账上货币资金与交易性金融资产不计入，只扣有息负债与少数股东权益');
  return `${bits.join('；')}。以上为自动测算口径，请在此补写你的判断：现金流为何这样假设、再投资需求、可分配现金、股本核对结果。`;
 }

 function savePanel(data){
  const row = rowsOf(data, SLOT_MAIN, true).find(r => r.code === saveCode);
  if(!row) return '';
  const inp = row.save_inputs || {};
  const fcff = (inp.forecasts || []).map(v => Number(v) / 1e8);
  const wacc = ((row.scenario && row.scenario.wacc) || {}).wacc_pct;
  const saved = savedOf(row);
  const field = (label, name, value) => `<label class="field">${label}<input type="number" name="${name}" step="any" value="${value}" required></label>`;
  return `<div class="panel" id="scenario-save-panel">
   <h3>存为我的基准情景 · ${esc(row.name||row.code)} <span class="code">${esc(row.code)}</span></h3>
   <p class="small muted">存档＝把这一行的自动测算固化成你的基准情景。存档后才会进入「最终候选」，也才会出现在导出 CSV 里。<strong>不改任何输入直接提交，存档后的每股价值与表里这一行逐位相同</strong>；要改的是现金流与股权桥——那正是自动口径替你做了取舍的地方。存档前提是这家公司已完成逐家公司审核并明确保留。</p>
   <form id="scenario-save-form" data-code="${esc(row.code)}">
    <div class="form-row">
     ${field('贴现率 WACC（%）','wacc', nval(wacc,4))}
     ${field('永续增长率（%）','terminal_growth', '1.0000')}
    </div>
    <details><summary class="small">现金流与股权桥（默认值＝这一行的自动测算口径，可覆盖）</summary>
     <div class="fcff-input-head"><strong>未来各年 FCFF</strong><span class="small muted">亿元</span></div>
     <div class="forecast-fields">${fcff.map((v,i)=>`<label class="field forecast-field">第 ${i+1} 年<input type="number" name="forecast" step="any" value="${nval(v,4)}" required></label>`).join('')}</div>
     <div class="form-row">
      ${field('可加回的非经营性现金（亿元）','cash', nval((inp.cash||0)/1e8,4))}
      ${field('其他非经营性资产（亿元）','other_assets', nval((inp.other_assets||0)/1e8,4))}
      ${field('有息债务（亿元）','debt', nval((inp.debt||0)/1e8,4))}
      ${field('少数股东权益调整（亿元）','minority', nval((inp.minority||0)/1e8,4))}
      ${field('其他优先索取权（亿元）','other_claims', nval((inp.other_claims||0)/1e8,4))}
      ${field('总股本（亿股）','shares', nval((inp.shares||0)/1e8,6))}
     </div>
     <p class="small muted">严格口径默认把账上现金按 0（不把货币资金与交易性金融资产算进估值）。若你认为这部分现金可自由分配，填进「可加回的非经营性现金」——填了结果就不再等于表里这一行，也不再是严格口径。</p>
    </details>
    <label class="field">假设依据（现金流、再投资、现金债务调整、股本）<textarea name="basis" rows="4" required>${esc(saveBasis(row))}</textarea></label>
    <label class="checkline"><input type="checkbox" name="confirmed" required>我已核对现金流口径、再投资需求、现金债务调整、少数股东权益及股本</label>
    <button class="primary" type="submit">${saved?'更新已存档的基准情景':'存为我的基准情景'}</button>
    <button type="button" data-save-cancel="1">取消</button>
   </form>
  </div>`;
 }

 // 并表口径跳变年：并购当年营运资本与少数股东权益一次性并入合并报表，
 // 当年 FCFF 与其他年份不可比。算得出但含跳变年的，标出来，不参与直接采信。
 function jumpTag(row){
  const jumps=((row||{}).scenario||{}).consolidation_jumps||[];
  if(!jumps.length) return '';
  const title=jumps.map(j=>`${j.year} 年：${(j.notes||[]).join('；')}`).join('\n');
  return `<br><span class="pill warning" title="${esc(title)}">含并表跳变年（${jumps.map(j=>j.year).join('、')}）</span>`;
 }

 function decisionTable(data, slot){
  const threshold = isNum(data?.margin_min_pct) ? Number(data.margin_min_pct) : NaN;
  const validThreshold = Number.isFinite(threshold) && threshold >= 0 && threshold < 100;
  const thrText = validThreshold ? num(threshold, 0) + '%' : '未配置';
  const thrHead = validThreshold ? '价格条件线 ' + num(threshold, 0) + '%' : '价格条件线（未配置）';
  const body = rowsOf(data, slot, true).map(row => {
   const neu = mainOf(row);
   const stress = row.scenario.stress || {};
   const complete = stress.complete === true && isNum(stress.low) && isNum(stress.high);
   const stressLow = complete ? Number(stress.low) : null;
   const stressPositive = stressLow !== null && stressLow > 0;
   const target = priceCondition(neu.per, threshold);
   const stressMargin = stressPositive && neu.comparable ? 1 - neu.price / stressLow : null;
   const condition = priceConditionText(row, neu, threshold, validThreshold);
   const bandCell = neu.low === null
    ? '<span class="pill warning">三档均无法测算</span>'
    : '¥' + num(neu.low) + ' ～ ¥' + num(neu.high);
   const targetCell = target === null ? '<span class="muted">—</span>' : '≤ ¥' + num(target);
   const marginCell = marginDisplay(neu.margin, true);
   const stressCell = complete ? '¥' + num(stress.low) + ' ～ ¥' + num(stress.high) : '<span class="muted">情景不完整</span>';
   const stressMarginCell = stressMargin === null
    ? '<span class="muted">—</span><br><span class="small muted">' + (complete ? '压力下限非正，不适用' : '情景不完整') + '</span>'
    : pct1(stressMargin);
   return `<tr data-tt-key="${esc(row.code)}">
    <td><button type="button" data-company="${esc(row.code)}">${esc(row.name||row.code)}</button><br><span class="small muted">自动估值 · 未复核</span>${jumpTag(row)}</td>
    <td>${isNum(neu.price)?'¥'+num(neu.price):'不可比较'}<br><span class="small muted">${esc(neu.priceDate)}</span></td>
    <td>${bandCell}<br><span class="small muted">主情景 ${MID_LABEL} 档 ${neu.per===null?'—':'¥'+num(neu.per)}</span></td>
    <td>${targetCell}</td>
    <td>${marginCell}</td>
    <td>${condition}</td>
    <td>${stressCell}</td>
    <td>${stressMarginCell}</td>
    <td>${saveCell(row)}</td>
   </tr>`;
  }).join('');
  const operating = data?.forecast_basis === 'operating';
  const intro = `<p class="small muted"><strong>${operating?'经营驱动估值（主口径）':'历史现金流诊断对照'}</strong>：${operating?'收入增长逐年收敛，利润率、税率、折旧、资本开支和营运资本按历史报表正常化，再逐年重建 FCFF':'本视图仅用于与旧的 FCFF 平推结果对照，不是主预测'}。WACC 取当前口径，永续增长率展示 1% / 2% / 3% 三档；主情景取 1%。</p>
  <p class="small muted"><strong>股权桥</strong>：${operating?'加回年报货币资金与交易性金融资产，减去有息负债、少数股东权益和优先股/永续债；来源年份在表内披露':'旧诊断口径：账上货币资金与交易性金融资产不进股权桥，这是「宁缺毋滥」——宁可漏掉好公司，也不多放进一家的旧从严取舍；判断层不因此放宽，判断仍按严格口径，披露不放宽'}。</p>
  <p class="small muted"><strong>价格条件只看主情景</strong>：安全边际 ＝ 1 − 收盘价 ÷ 主情景内在价值（折价口径）；${thrHead} ＝ 主情景内在价值 ×（1 − ${thrText}）。安全边际的作用是抵消我自己预测的误差，不是提前假设「未来一定变差」。</p>
  <p class="small muted"><strong>压力校验区间</strong>（原 24 组机械情景：现金流原值 / 全部低 20%，WACC 当前 / +1 / +2 个百分点，永续增长 0% / 1% / 2% / 3%）保留为辅助观察，不控制价格条件。那是灾难情景，拿它当门槛会把所有公司都判成不合格。</p>
  <p class="small muted"><strong>顺序别弄反</strong>：先做定性筛选——ROIC 持续高于 WACC、有护城河、现金流稳定、杠杆可控（在「严格财务预筛」和「投资核查清单」里），确认是好生意，再谈估值折扣。本页只管价格这一段。</p>`;
  return `<div class="panel"><h3>股价、自动估值与价格门槛</h3>${intro}<div class="scroll"><table data-tt-sync="${esc(slot||SLOT_MAIN)}"><thead><tr><th>公司 / 状态</th><th>当前收盘价 / 日期</th><th>三档每股范围 / 元每股</th><th>${thrHead}</th><th>主情景安全边际（主判断）</th><th>价格条件</th><th>压力校验区间（辅助观察）</th><th>相对压力下限的安全边际（辅助）</th><th>存为我的基准情景</th></tr></thead><tbody>${body}</tbody></table></div><p class="small muted">门槛随模型假设变化，达到价格条件仍不等于可以买入。待复核：生意是否可预测、一次性项目、维持经营所需资本支出与营运资本、可分配现金、负债与少数股东权益，以及长期增长能否由再投资支持。历史 FCFF 不等于已经核实的股东盈余。</p></div>`;
 }

 function skippedOf(data){
  const skipped = data?.skipped || [];
  if(!skipped.length) return '';
  const rows = skipped.map(item => `<tr><td>${esc(item.code)}</td><td>${esc(item.name || '—')}${jumpTag(item)}</td><td>${esc((item.missing || []).join('；'))}</td></tr>`).join('');
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
   <p><strong>这是自动估值情景，尚未研究复核。</strong>本页采用${data.forecast_basis==='operating'?'经营驱动预测：收入、EBIT、NOPAT、折旧、资本开支和营运资本逐年可追溯':(data.forecast_basis==='latest'?'最近一年 FCFF 平推五年（诊断对照），假设单年现金流水平持续':(data.forecast_basis==='mean'?'最近五年 FCFF 均值平推（诊断对照）':'最近五年 FCFF 中位数平推（诊断对照）'))}；永续增长率取 1%/2%/3% 三档。测算结果不写入估值存档，也不进最终候选。</p>
   <p><strong>判断顺序：先筛生意，再谈折扣。</strong>定性筛选（ROIC 持续高于 WACC、有护城河、现金流稳定、杠杆可控）在「严格财务预筛」和「投资核查清单」里；本页的保守机械估值只负责排出研究先后，必须经人工修改现金流和核对股权桥后才能存为基准情景。</p>
   <p><strong>股权桥按报表可追溯。</strong>${data.forecast_basis==='operating'?'货币资金与交易性金融资产加回，有息负债、少数股东权益和优先索取权扣除，不再用「现金一律为零」的非对称口径':'本历史对照视图仍保留旧口径，不用作主判断'}。</p>
   <p><strong>DCF 股权价值为负的直接剔除。</strong>企业价值连有息债务与少数股东权益都覆盖不了，就谈不上持续创造超额收益——这类标的不进主表、不参与排序、不参与价格判断。${dropped?`本轮剔除了 ${dropped} 家，剔的是谁、剔的理由、以及未计入多少现金，都列在下面的清单里，可以自己复核。`:'本轮没有出现股权价值为负的标的。'}</p>
   <p>${high} / ${rows.length} 家的终值占企业价值 60% 以上，${swings} 家在三档之间安全边际摆动超过 20 个百分点：这两个数说明结果对假设的依赖程度，请把它当排序参考，不是买入结论。</p>
   <p>债务用账面值代替市值，非经营性现金以外的资产也未加回。报价过期时不比安全边际，宁可不比也不拿旧价凑数。</p>
   ${jumpWarning(rows)}
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
   <p class="small muted">这几家在三档（永续增长率 1%/2%/3%）下的股权价值都是负的，已从上面的主表与区间图里去掉，不参与排序与价格判断。判定用的是严格口径（账上现金不计入股权桥）；下面同时补上未计入的现金、计入后是什么数与收盘价，方便自己复核这个剔除站不站得住。</p>
   <div class="scroll"><table><thead><tr><th>公司</th><th>主情景 ${MID_LABEL} 档股权价值</th><th>严格口径：账上现金未计入</th><th>若计入现金</th><th>收盘价</th><th>剔除理由</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
 }

 // 并表口径跳变的统一说明：把「算得出但不可比」和「真算不出」分开讲。
 function jumpWarning(rows){
  const jumped=rows.filter(row=>((row.scenario||{}).consolidation_jumps||[]).length);
  if(!jumped.length){
   return '<p><strong>并表口径跳变</strong>：本页没有公司落在并购或引战造成的口径跳变年上。</p>';
  }
  const names=jumped.map(row=>`${row.name||row.code}（${((row.scenario||{}).consolidation_jumps||[]).map(j=>j.year).join('、')} 年）`);
  return `<p><strong>并表口径跳变</strong>：${jumped.length} 家的最近五年里含并购或引战造成的口径跳变年——${names.join('、')}。这些年份营运资本与少数股东权益一次性并入合并报表，对应的盈利还没进来，那一年的 FCFF 与其他年份<strong>不可比</strong>，不是经营现金流变差。表里标了「含并表跳变年」；算不出而原因是跳变的，原因句里会写明该单独建模，不要当成生意不行。</p>`;
 }

 function render(data){
  last = data || null;
  const views=data?.views;
  const coverage=selectedBasis==='coverage'&&Array.isArray(data?.supplementary_rows);
  const basis=coverage?'coverage':(views?.[selectedBasis]?selectedBasis:(views?.conservative?'conservative':'operating'));
  const supplementary=coverage?data.supplementary_rows:[];
  const count=(views?.operating?.rows?.length||0)+(data?.supplementary_rows?.length||0);
  const switches=views?`<div class="panel"><h3>估值测算口径</h3><div class="actions">${[['conservative','保守正式排名',views.conservative?.rows?.length||0],['operating','经营驱动预测（待验证）',views.operating?.rows?.length||0],['coverage','全部结果 · 分口径',count],['median','FCFF 中位数对照',views.median?.rows?.length||0],['mean','FCFF 均值对照',views.mean?.rows?.length||0],['latest','最近年 FCFF 对照',views.latest?.rows?.length||0]].map(([key,label,n])=>`<button type="button" data-scenario-basis="${key}" aria-pressed="${basis===key}">${label}（${n} 家）</button>`).join('')}</div><p class="small muted"><strong>正式排名规则</strong>：经营预测未通过门禁时采用历史 FCFF 中位数；通过后，中位数估值与经营估值取较低值。均值、最近年和未验证经营预测只作对照，不抢占正式排名。</p></div>`:'';
  data=coverage?{...data,skipped:data.coverage_skipped||[],forecast_basis:'operating'}:(views?.[basis]?{...data,...views[basis],forecast_basis:basis}:data);
  const rows = rowsOf(data, SLOT_MAIN, true);
  const dropped = rowsOf(data, SLOT_MAIN).filter(isNegativeEquity);
  const supplementaryKept = supplementary.filter(row => !isNegativeEquity(row));
  const supplementaryDropped = supplementary.filter(isNegativeEquity);
  const allDropped = dropped.concat(supplementaryDropped);
  const threshold = Number(data?.margin_min_pct) || 0;
  const pricePassed = rows.filter(row => meetsThreshold(scenarioOf(row, MID).margin, threshold)).length;
  const researchRows = rows.filter(row => meetsThreshold(scenarioOf(row, MID).margin, threshold) && researchReady(row));
  const researchPassed = researchRows.length;
  const researchData = {...data, rows: researchRows, skipped: []};
  const generated = data?.generated_at ? String(data.generated_at).replace('T', ' ').slice(0, 16) : '—';
  return `
  ${switches}
  ${warnings(data)}
  <div class="panel"><h3>严格研究候选：${researchPassed} 家</h3>
   ${researchPassed
    ? '<p class="small muted">以下公司同时通过价格条件与预测/估值门禁，仍需人工核查管理层、护城河与风险清单。</p>' + decisionTable(researchData, SLOT_MAIN)
    : '<p class="notice">当前没有公司同时通过价格条件与预测/估值门禁。看起来便宜，不等于内在价值已被可靠验证。</p>'}
  </div>
  ${savePanel(data)}
  ${droppedPanel(allDropped)}
  <div class="stats">
   <div class="stat"><span class="muted">已生成测算</span><strong>${rows.length+supplementaryKept.length}</strong><span class="small">家${coverage?' · 经营驱动 '+rows.length+' 家，历史对照补充 '+supplementaryKept.length+' 家':'（当前统一口径）'}${allDropped.length?' · 已剔除 '+allDropped.length+' 家':''}</span></div>
   <div class="stat"><span class="muted">${coverage?'五年中位数 · ':''}价格条件 / 研究达标</span><strong>${pricePassed} / ${researchPassed}</strong><span class="small">价格条件 ${pricePassed} 家；研究达标 ${researchPassed} 家 · 不可用门槛代替模型可信度</span></div>
   <div class="stat"><span class="muted">需补资料或单独建模</span><strong>${(data?.skipped || []).length}</strong><span class="small">家 · 原因已列明</span></div>
   <div class="stat"><span class="muted">DCF 股权价值为负</span><strong>${allDropped.length}</strong><span class="small">家 · 已剔除，不参与排序与价格判断</span></div>
  </div>
  <div class="panel">
   <div class="vs-chart-head">
    <div class="vs-chart-titlerow">
     <h3>严格候选的三档安全边际</h3>
     <div class="vs-legend"><span><i class="vs-key vs-key-band"></i>三档区间</span><span><i class="vs-key vs-key-dot"></i>${MID_LABEL} 档落点</span><span><i class="vs-key vs-key-threshold"></i>${threshold}% 价格条件线</span><span><i class="vs-key vs-key-safe"></i>仅价格条件区（非研究达标）</span><span><i class="vs-key vs-key-stress"></i>压力校验下限</span></div>
    </div>
    <p class="small muted">横轴是安全边际（现价比内在价值便宜了多少，折价口径）。每条横带的<strong>左端是永续增长率 1% 档、右端是 3% 档</strong>，圆点是 ${MID_LABEL} 档落点；数值下面那行<strong>带宽</strong>＝三档之间安全边际的摆动幅度，越宽说明这个结论越依赖永续增长率这一个假设。竖虚线是 ${threshold}% 价格条件线，竖实线是 0 轴：<strong>区间跨过 0 轴的，说明换个假设「贵」就变成「便宜」，这类最需要警惕</strong>。带的颜色按 ${MID_LABEL} 档落点分：绿＝价格条件与预测/估值门禁同时通过，黄灰＝价格达线但门禁未通过，橙＝在 0 与门槛之间，灰＝落点为负。<strong>右侧浅绿底只是价格条件区，不等于研究达标。</strong>细竖线是压力校验下限折算后的位置，淡虚线把它连到三档带左端——那一段就是主情景离灾难情景还有多远；只作辅助观察，不控制价格条件。</p>
   </div>
   <div class="vs-chart-wrap">${bandChart(researchData)}</div>
   ${researchPassed?`<p class="small muted">横轴范围 ${axisDomain(researchData).lo}% ～ ${axisDomain(researchData).hi}%；低于左端的区间折叠到边缘并标 ◀。</p>`:''}
   <p class="small muted"><strong>带宽为什么有的宽有的窄</strong>——由三件事共同决定（实测三因素合起来对带宽的解释力约 0.76）：①<strong>终值占企业价值的比重</strong>，永续增长率只影响终值，比重越高越敏感（本页 70%～88%）；②<strong>WACC 与永续增长率的间距</strong>，终值 ∝ 1÷(WACC−g)，WACC 越低、g 越靠近它，同样挪 2 个百分点，估值变动越大（法拉电子 WACC 9.13% 时终值只涨 35%，华润江中 WACC 4.56% 时涨 109%）；③<strong>落点离 0 的距离</strong>，安全边际 ＝ 1 − 现价 ÷ 内在价值，落点接近 0 时，企业价值的相对变化几乎 1:1 映射到安全边际，条自然更宽。</p>
   <p class="small muted"><strong>带宽怎么用</strong>：条窄、且整条都在门槛右侧，说明三档假设下都达标，结论稳；条宽、并跨过 0 轴，说明「贵还是便宜」取决于永续增长率取 1% 还是 3%，这类不该按单一落点下判断。</p>
  </div>
  ${researchPassed?`<div class="panel"><h3>严格候选逐家结果</h3>${tableOf(researchData, SLOT_MAIN)}</div>`:''}
  <details class="panel vs-diagnostics">
   <summary><strong>机械估值诊断（${rows.length} 家，不是候选股）</strong></summary>
   <p class="small muted">这些数字用于查找估值模型哪里过度乐观；未通过门禁的公司不进主榜。价格条件不等于企业内在价值已被可靠验证。</p>
   ${decisionTable(data, SLOT_MAIN)}
   <div class="vs-chart-wrap">${bandChart(data)}</div>
   <p class="small muted">每股情景估值来自自动草案 + 当前口径 WACC；报价每个交易日 23:30 后自动更新；测算时间 ${esc(generated)}。</p>
   ${tableOf(data, SLOT_MAIN)}
  </details>
  ${supplementary.length?`<div class="panel"><h3>补充测算 · ${supplementary.length} 家</h3><p class="small muted">以下公司五年中位数不满足条件，采用表内注明的替代口径。五年均值会受并购、扩产和营运资本波动影响；单年情景假设近期现金流水平持续，尚未证明进入稳定期。补充结果不混入上方排名，也不自动进入最终候选。</p>${supplementary.map(row=>`<p class="small muted"><strong>${esc(row.name)}</strong>：${esc((row.primary_missing||[]).join('；'))}；补充采用 ${esc(row.scenario.forecast.method)}。</p>`).join('')}${decisionTable({...data,rows:supplementary}, SLOT_SUPP)}${tableOf({...data,rows:supplementary}, SLOT_SUPP)}</div>`:''}
  ${skippedOf(data)}`;
 }

 // 存档在批量测算这一页完成：点行内按钮展开表单，提交后写进估值存档。
 // 存档后这家公司才会进入「最终候选」，也才会出现在导出 CSV 里。
 // render() 只负责产出 HTML，写进页面的是 app.js 的 renderScenarios()。
 // 这里改了模块内部状态就调它重画，别自己写 innerHTML——两条渲染路径会打架。
 function repaint(){
  if(typeof renderScenarios==='function'){ renderScenarios(); return; }
  const box=document.getElementById('scenarios-content');
  if(box&&last) box.innerHTML=render(last);
 }

 document.addEventListener('click', event=>{
  const open = event.target.closest('[data-save-code]');
  if(open){
   saveCode = open.dataset.saveCode;
   repaint();
   const panel=document.getElementById('scenario-save-panel');
   if(panel) panel.scrollIntoView({behavior:'smooth', block:'center'});
   return;
  }
  if(event.target.closest('[data-save-cancel]')){
   saveCode = null;
   repaint();
  }
 });

 document.addEventListener('submit', async event=>{
  const form = event.target;
  if(!form || form.id !== 'scenario-save-form') return;
  event.preventDefault();
  const fd = new FormData(form);
  const inputs = {
   forecasts: fd.getAll('forecast').map(x => Number(x) * 1e8),
   wacc: Number(fd.get('wacc')) / 100,
   terminal_growth: Number(fd.get('terminal_growth')) / 100,
   basis: String(fd.get('basis') || ''),
   confirmed: fd.has('confirmed'),
  };
  for(const key of ['cash','other_assets','debt','minority','other_claims','shares']) inputs[key] = Number(fd.get(key)) * 1e8;
  try{
   await api('/api/value', {code: form.dataset.code, inputs});
   await load();
   await loadScenarios(true);
   feedback('基准情景已保存：这家公司现在会出现在「最终候选」和导出 CSV 里。');
  }catch(err){ feedback(err.message); }
 });

 function renderCharts(){ /* SVG 图不需要 ECharts 实例，重新渲染即可 */ }

 function resizeCharts(){ renderCharts(); }

 return {render, renderCharts, resizeCharts, selectBasis, applyOrder, currentBasis:()=>selectedBasis};
})();
