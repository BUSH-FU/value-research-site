'use strict';

// 批量测算视图：每股内在价值与安全边际。
//
// 自动估值尚未经研究复核：预测用自动草案（最近五年 FCFF 中位数平推五年，
// 零显性增长），永续增长率没有官方值，所以给 1%/2%/3% 三档敏感性。
// 结果不写入估值存档，也不进最终候选。
//
// 三条硬规矩（和市场情绪、周期那页一致）：
// 1. 数字只有一种来源：服务器算好的真实读数。缺数据写「缺什么」，不拿示例值顶替。
// 2. 区间和阈值必须画成图，并且标出落点——三档永续增长率本身就是一条区间，
//    所以每家画一条区间带，落点标 2% 档，再把 30% 门槛线和 0 轴画出来。
// 3. 颜色与宽度一律走 CSS 类或 CSSOM 赋值：服务器 CSP 是 style-src 'self'，
//    行内 style 属性会被浏览器静默忽略（这个坑本项目已经踩过三次）。
window.ValuationScenarios = (() => {
 const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num = (x, n=2) => x === null || x === undefined || x === '' ? '—' : Number(x).toLocaleString('zh-CN', {maximumFractionDigits:n, minimumFractionDigits:n});
 const isNum = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
 const pct1 = x => isNum(x) ? num(Number(x) * 100, 1) + '%' : '—';
 const KEYS = ['g1%','g2%','g3%'];
 const MID = 'g2%';
 const AXIS_MIN = -100;   // 横轴左端：低于这个值的区间折叠到边缘并标记 ◀
 const AXIS_MAX = 90;     // 横轴右端

 let last = null;
 let selectedBasis = 'coverage';
 function selectBasis(value){if(['coverage','latest','median','mean'].includes(value))selectedBasis=value;}

 const scenarioOf = (row, key) => (((row || {}).scenario || {}).scenarios || {})[key] || {};
 const margins = row => KEYS.map(k => scenarioOf(row, k).margin).filter(isNum).map(Number);
 // 安全边际在数据里是小数（0.668），门槛是百分数（30）。图上的横轴是百分数，
 // 所以画图前一律换成百分点再比、 再定位——把小数直接当百分点会整体错位。
 const marginPcts = row => margins(row).map(v => v * 100);
 const meetsThreshold = (margin, threshold) => isNum(margin) && Number(margin) * 100 >= threshold;

 function rowsOf(data){ return (data?.rows || []).filter(r => r?.scenario?.ready); }

 function axisDomain(data){
  const rows = rowsOf(data);
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
  const rows = rowsOf(data);
  if(!rows.length) return '<p class="small muted">目前没有能测算的公司。</p>';
  const threshold = Number(data?.margin_min_pct) || 0;
  const {lo, hi} = axisDomain(data);
  const W = 1080, NAME_W = 158, VAL_W = 96, TOP = 34, ROW_H = 32, BOTTOM = 48;
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
  const thresholdLine = `<line x1="${x(threshold).toFixed(1)}" y1="${TOP - 12}" x2="${x(threshold).toFixed(1)}" y2="${height - BOTTOM + 4}" class="vs-threshold"/><text x="${x(threshold).toFixed(1)}" y="${TOP - 18}" text-anchor="middle" class="vs-threshold-label">${threshold}% 门槛</text>`;

  const body = rows.map((row, index) => {
   const values = marginPcts(row);
   const low = Math.min(...values), high = Math.max(...values);
   const mid = scenarioOf(row, MID).margin;
   const midValid = isNum(mid);
   const midPct = midValid ? Number(mid) * 100 : null;
   const clipped = low < lo;
   const tone = midPct === null ? 'negative' : (midPct >= threshold ? 'positive' : (midPct >= 0 ? 'thin' : 'negative'));
   const x1 = x(low), x2 = x(high);
   const title = KEYS.map(k => {
    const s = scenarioOf(row, k);
    const per = s.valid === false ? '股权价值为负（不参与比较）' : (isNum(s.per_share) ? '¥' + num(s.per_share) : '无效');
    return `${k}：每股 ${per}，安全边际 ${pct1(s.margin)}`;
   }).join('；');
   const mark = clipped ? `<text x="${plotLeft + 6}" y="${y(index) + 4}" class="vs-clipped">◀</text>` : '';
   const dot = midValid ? `<circle cx="${x(midPct).toFixed(1)}" cy="${y(index)}" r="5.5" class="vs-dot ${tone}"/>` : '';
   const label = midValid ? pct1(mid) : (isNum(scenarioOf(row, MID).per_share) ? '股权为负' : '—');
   return `<g class="vs-row">
    <text x="${NAME_W - 14}" y="${y(index) + 4}" text-anchor="end" class="vs-name">${esc(row.name || row.code)}</text>
    <rect x="${x1.toFixed(1)}" y="${(y(index) - 7).toFixed(1)}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="14" rx="4" class="vs-band ${tone}"/>
    ${dot}${mark}
    <text x="${plotRight + 12}" y="${y(index) + 4}" class="vs-value ${tone}">${esc(label)}</text>
    <title>${esc(row.name || row.code)}（${esc(row.code)}）：${esc(title)}</title>
   </g>`;
  }).join('');

  return `<svg class="vs-chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="各公司安全边际区间与 2% 档落点">${safeZone}${ticks.join('')}${zeroLine}${thresholdLine}${body}</svg>`;
 }

 function tableOf(data){
  const rows = rowsOf(data);
  if(!rows.length) return '<div class="empty">目前没有能测算的公司。</div>';
  const head = '<tr><th>公司</th><th>收盘价 / 日期</th><th>基准 FCFF / 亿元</th><th>五年中位数 / 亿元</th><th>当前口径 WACC</th><th>1% 档每股</th><th>2% 档每股</th><th>3% 档每股</th><th>2% 档安全边际</th><th>终值占企业价值</th><th>报表货币资金未计入</th></tr>';
  const body = rows.map(row => {
   const s = row.scenario || {};
   const wacc = s.wacc || {};
   const mid = scenarioOf(row, MID);
   const forecast = s.forecast || {};
   const per = key => {
    const sc = scenarioOf(row, key);
    if(!isNum(sc.per_share)) return '<span class="muted">—</span>';
    if(sc.valid === false) return '<span class="pill warning">股权为负</span>';
    return '¥' + num(sc.per_share);
   };
   const margin = isNum(mid.margin) ? '<strong>' + pct1(mid.margin) + '</strong>' : '<span class="muted">—</span>';
   const terminal = isNum(mid.terminal_share) ? pct1(mid.terminal_share) : '—';
   const cash = isNum(forecast.cash_not_counted_yi) && forecast.cash_not_counted_yi > 0
    ? num(forecast.cash_not_counted_yi) + ' 亿（每股约 ' + num(forecast.cash_per_share_ignored) + ' 元）'
    : '<span class="muted">未取到</span>';
   const price = isNum(mid.price) ? '¥' + num(mid.price) + ' / ' + esc(mid.price_date || '—') : '<span class="muted">报价不可用</span>';
   return `<tr>
    <td><button type="button" data-company="${esc(row.code)}" data-forecast-basis="${esc(row.scenario?.forecast?.basis||'median')}">${esc(row.name || row.code)}</button> <span class="code">${esc(row.code)}</span>${row.industry ? ' <span class="muted small">' + esc(row.industry) + '</span>' : ''}</td>
    <td>${price}</td>
    <td>${num(forecast.fcff_yi)}<br><span class="small muted">${forecast.basis==='latest'?esc(forecast.source_year)+' 年':(forecast.basis==='mean'?'五年均值':'五年中位数')}</span></td><td>${num(forecast.five_year_median_yi)}</td>
    <td>${isNum(wacc.wacc_pct) ? num(wacc.wacc_pct) + '%' : '<span class="muted">—</span>'}</td>
    <td>${per('g1%')}</td><td>${per('g2%')}</td><td>${per('g3%')}</td>
    <td>${margin}</td><td>${terminal}</td><td>${cash}</td>
   </tr>`;
  }).join('');
  return `<div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
 }

 function decisionTable(data){
  const threshold = isNum(data?.margin_min_pct) ? Number(data.margin_min_pct) : NaN;
  const validThreshold = Number.isFinite(threshold) && threshold >= 0 && threshold < 100;
  const body = rowsOf(data).map(row => {
   const stress = row.scenario.stress || {}, mid = scenarioOf(row, MID);
   const complete = stress.complete === true && isNum(stress.low) && isNum(stress.high);
   const positive = complete && Number(stress.low) > 0;
   const target = positive && validThreshold ? Number(stress.low) * (1-threshold/100) : null;
   const comparable = mid.compare_state === 'compared' && isNum(mid.price);
   const margin = positive && comparable ? 1-Number(mid.price)/Number(stress.low) : null;
   const condition = !complete ? '压力情景不完整，需复核' : !positive ? '压力下股权价值非正，暂无正买入价门槛' : !validThreshold ? '请配置安全边际门槛' : !comparable ? '报价不可比较' : Number(mid.price)<=target ? '达到价格条件，仍需研究复核' : '尚未达到价格条件';
   return `<tr><td><button type="button" data-company="${esc(row.code)}" data-forecast-basis="${esc(row.scenario.forecast?.basis||'median')}">${esc(row.name||row.code)}</button><br><span class="small muted">自动估值 · 未复核</span></td><td>${comparable?'¥'+num(mid.price):'不可比较'}<br><span class="small muted">${esc(mid.price_date||'—')}</span></td><td>${complete?'¥'+num(stress.low)+' ～ ¥'+num(stress.high):'情景不完整'}</td><td>${target===null?'—':'≤ ¥'+num(target)}</td><td>${pct1(margin)}</td><td>${condition}</td></tr>`;
  }).join('');
  return `<div class="panel"><h3>股价、自动估值与价格门槛</h3><p class="small muted">范围来自 24 个机械压力情景：当前 WACC / 加 1 / 加 2 个百分点，永续增长率 0% / 1% / 2% / 3%，预测现金流原值 / 全部降低 20%。其余假设不变，负股权价值照实保留。这些压力幅度用于检验敏感性，不是巴菲特参数，也不是价值的置信区间。</p><p class="small muted">价格门槛 = 压力情景下限 ×（1 − ${validThreshold?num(threshold,0):'未配置'}% 安全边际）；当前安全边际 = 1 − 股价 ÷ 压力情景下限。门槛随模型假设变化，达到价格条件仍不等于可以买入。</p><div class="scroll"><table><thead><tr><th>公司 / 状态</th><th>当前收盘价 / 日期</th><th>自动情景范围 / 元每股</th><th>${validThreshold?num(threshold,0)+'%':''} 安全边际价格门槛</th><th>相对压力下限的安全边际</th><th>价格条件</th></tr></thead><tbody>${body}</tbody></table></div><p class="small muted">待复核：生意是否可预测、一次性项目、维持经营所需资本支出与营运资本、可分配现金、负债与少数股东权益，以及长期增长能否由再投资支持。历史 FCFF 不等于已经核实的股东盈余。</p></div>`;
 }

 function skippedOf(data){
  const skipped = data?.skipped || [];
  if(!skipped.length) return '';
  const rows = skipped.map(item => `<tr><td>${esc(item.code)}</td><td>${esc(item.name || '—')}</td><td>${esc((item.missing || []).join('；'))}</td></tr>`).join('');
  return `<div class="panel"><h3>当前口径暂不能自动测算的 ${skipped.length} 家</h3><p class="small muted">逐家列出数据缺项或模型条件；可切换另一种现金流口径对照。</p><div class="scroll"><table><thead><tr><th>代码</th><th>公司</th><th>原因</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
 }

 function warnings(data){
  const rows = rowsOf(data);
  const terminals = rows.map(r => scenarioOf(r, MID).terminal_share).filter(isNum).map(Number);
  const high = terminals.filter(v => v >= 0.6).length;
  const swings = rows.filter(row => {
   const values = marginPcts(row);
   return values.length > 1 && Math.max(...values) - Math.min(...values) > 20;
  }).length;
  return `<div class="notice vs-notice">
   <p><strong>这是自动估值情景，尚未研究复核。</strong>本页采用${data.forecast_basis==='latest'?'最近一年 FCFF 平推五年（零显性增长）。这是假设单年现金流水平持续，尚未剔除一次性项目，也未证明已进入稳定期；请切换五年中位数对照':(data.forecast_basis==='mean'?'最近五年 FCFF 均值平推五年（包括全部负值年份，受极端年份影响）':'最近五年 FCFF 中位数平推五年（零显性增长）')}，永续增长率取 1%/2%/3% 三档——没有任何官方值，所以不设默认档。测算结果不写入估值存档，也不进最终候选。</p>
   <p>${high} / ${rows.length} 家的终值占企业价值 60% 以上，${swings} 家在三档之间安全边际摆动超过 20 个百分点：这两个数说明结果对假设的依赖程度，请把它当排序参考，不是买入结论。</p>
   <p>报表货币资金暂按 0 计（尚未辨别可分配现金），下表写明各家漏算了多少；债务用账面值代替市值，非经营性现金以外的资产也未加回。报价过期时不比安全边际，宁可不比也不拿旧价凑数。</p>
  </div>`;
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
  const rows = rowsOf(data);
  const threshold = Number(data?.margin_min_pct) || 0;
  const passed = rows.filter(row => meetsThreshold(scenarioOf(row, MID).margin, threshold)).length;
  const invalid = rows.filter(row => scenarioOf(row, MID).valid === false).length;
  const generated = data?.generated_at ? String(data.generated_at).replace('T', ' ').slice(0, 16) : '—';
  return `
  ${switches}
  ${warnings(data)}
  ${decisionTable(data)}
  <div class="stats">
   <div class="stat"><span class="muted">已生成测算</span><strong>${rows.length+supplementary.length}</strong><span class="small">家${coverage?' · 五年中位数 '+rows.length+' 家，补充 '+supplementary.length+' 家':'（当前统一口径）'}</span></div>
   <div class="stat"><span class="muted">${coverage?'五年中位数 · ':''}2% 档达标</span><strong>${passed}</strong><span class="small">家 · 门槛安全边际 ≥ ${threshold}%</span></div>
   <div class="stat"><span class="muted">需补资料或单独建模</span><strong>${(data?.skipped || []).length}</strong><span class="small">家 · 原因已列明</span></div>
   <div class="stat"><span class="muted">${coverage?'五年中位数 · ':''}股权价值为负</span><strong>${invalid}</strong><span class="small">家 · 不参与排序</span></div>
  </div>
  <div class="panel">
   <div class="vs-chart-head">
    <div><h3>安全边际区间与落点</h3><p class="small muted">横轴是安全边际（现价相对该情景估值折了多少）。每条横带是永续增长率 1%～3% 之间的区间，圆点是 2% 档的落点；竖虚线是 ${threshold}% 门槛，竖实线是 0 轴。</p></div>
    <div class="vs-legend"><span><i class="vs-key vs-key-band"></i>三档区间</span><span><i class="vs-key vs-key-dot"></i>2% 档落点</span><span><i class="vs-key vs-key-threshold"></i>${threshold}% 门槛</span><span><i class="vs-key vs-key-safe"></i>达标段</span></div>
   </div>
   <div class="vs-chart-wrap">${bandChart(data)}</div>
   <p class="small muted">横轴范围 ${axisDomain(data).lo}% ～ ${axisDomain(data).hi}%；低于左端的区间折叠到边缘并标 ◀，确切数字见下表。区间越长，说明这家的结论越依赖永续增长率这一个假设。</p>
  </div>
  <div class="panel">
   <h3>逐家测算结果</h3>
   <p class="small muted">每股情景估值来自自动草案 + 当前口径 WACC；报价取最近一个交易日的未复权收盘价（每个交易日 16:30 后自动更新）。测算时间 ${esc(generated)}。</p>
   ${tableOf(data)}
  </div>
  ${supplementary.length?`<div class="panel"><h3>补充测算 · ${supplementary.length} 家</h3><p class="small muted">以下公司五年中位数不满足条件，采用表内注明的替代口径。五年均值会受并购、扩产和营运资本波动影响；单年情景假设近期现金流水平持续，尚未证明进入稳定期。补充结果不混入上方排名，也不自动进入最终候选。</p>${supplementary.map(row=>`<p class="small muted"><strong>${esc(row.name)}</strong>：${esc((row.primary_missing||[]).join('；'))}；补充采用 ${esc(row.scenario.forecast.method)}。</p>`).join('')}${decisionTable({...data,rows:supplementary})}${tableOf({...data,rows:supplementary})}</div>`:''}
  ${skippedOf(data)}`;
 }

 function renderCharts(){ /* SVG 图不需要 ECharts 实例，重新渲染即可 */ }

 function resizeCharts(){ renderCharts(); }

 return {render, renderCharts, resizeCharts, selectBasis, currentBasis:()=>selectedBasis};
})();
