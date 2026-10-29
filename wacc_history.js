'use strict';

// 逐年资金成本与价值创造：每一年的 WACC 都按那一年的市场数据重算。
//
// 为什么单独做一块：原来全公司只有一个 WACC，被铺在二十几个年度行上，
// 读起来像「当年的资金成本」，实际是「今天的资金成本回看历史」。
// 这两者会给出相反的结论——股价高企的年份股权市值大、权重高，WACC 天然被抬高。
//
// 三条硬规矩（和周期属性那页一致）：
// 1. 数字只有一种来源：服务器按当年市场数据算好的真实读数。缺数据写「待补」并写明缺哪一项。
// 2. 颜色与宽度一律走 CSS 类或 CSSOM 赋值 —— 服务器 CSP 是 style-src 'self'，
//    行内 style 属性会被浏览器静默忽略（这个坑本项目已经踩过三次）。
// 3. 口径与失真都要写在页面上，不只写在代码注释里。
window.WaccHistory = (() => {
 const charts = [];
 const isNum = value => value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value));
 const pct = (value, digits=2) => isNum(value)?num(Number(value), digits)+'%':'—';
 const yiText = value => isNum(value)?num(Number(value)/1e8, 1)+' 亿':'—';
 const readyRows = record => ((record&&record.years)||[]).filter(row=>row&&row.status==='available');
 const pendingRows = record => ((record&&record.years)||[]).filter(row=>row&&row.status!=='available');
 const dateText = value => {const text=String(value||'');return text.length>10?text.slice(0,10):text;};

 // 年度 → 逐年记录。年度总览表要用它把「ROIC － 当年 WACC」换成真实逐年值。
 function yearMap(record){
  const map=new Map();
  for(const row of readyRows(record))map.set(Number(row.year),row);
  return map;
 }

 function compositionTable(rows){
  const body=rows.map(row=>`<tr>
   <td>${esc(row.year)}</td>
   <td>${isNum(row.price)?num(row.price,2):'—'}${row.price_date?`<small class="wacc-note">${esc(dateText(row.price_date))}</small>`:''}</td>
   <td>${yiText(row.equity)}</td>
   <td>${pct(row.equity_weight_pct,1)}</td>
   <td>${pct(row.rf_pct)}</td>
   <td>${isNum(row.beta)?num(row.beta,3):'—'}${row.beta_samples?`<small class="wacc-note">${esc(row.beta_samples)} 日 R² ${num(row.beta_r2,2)}</small>`:''}</td>
   <td>${pct(row.premium_pct)}${row.premium_note?`<small class="wacc-warn">${isNum(row.premium_pct)&&row.premium_pct<=0?'口径失真':'溢价接近零'}</small>`:''}</td>
   <td>${pct(row.cost_of_equity_pct)}</td>
   <td>${pct(row.debt_cost_pct)}</td>
   <td>${pct(row.tax_rate_pct)}</td>
   <td><strong>${pct(row.wacc_pct)}</strong></td>
   <td>${pct(row.roic_pct)}</td>
   <td class="${isNum(row.spread_pct)?(row.spread_pct>=0?'wacc-pos':'wacc-neg'):''}">${isNum(row.spread_pct)?(row.spread_pct>=0?'+':'')+num(row.spread_pct)+' 个百分点':'—'}</td>
  </tr>`).join('');
  return `<div class="scroll"><table class="wacc-history-table">
   <thead><tr><th>年度</th><th>年末收盘价</th><th>股权市值 E</th><th>股权占比</th><th>Rf</th><th>β</th><th>股权溢价</th><th>股权成本</th><th>税前债务成本</th><th>有效税率</th><th>当年 WACC</th><th>当年 ROIC</th><th>差额</th></tr></thead>
   <tbody>${body}</tbody></table></div>`;
 }

 function pendingList(rows){
  if(!rows.length)return '';
  return `<div class="wacc-pending"><h4>算不出的年度</h4><ul>${rows.map(row=>`<li><strong>${esc(row.year)}</strong>：${esc((row.missing||[]).join('、')||'缺数据')}</li>`).join('')}</ul>
   <p class="small muted">缺哪一项就写明哪一项，不用别的年份的值顶替，也不按零算。</p></div>`;
 }

 function panel(record){
  if(!record){
   return `<div class="panel" id="wacc-history-panel"><h3>逐年资金成本与价值创造</h3><p class="muted">正在读取逐年资金成本…</p></div>`;
  }
  if(record.status!=='available'){
   return `<div class="panel" id="wacc-history-panel"><h3>逐年资金成本与价值创造</h3>
    <p class="muted">${esc(record.message||'逐年资金成本尚未取得。')}</p>
    <p class="small muted">逐年 WACC 需要每年年末的中债曲线、沪深300 官方估值、当年年末股价与年报数据；缺哪一项就写明原因，不拿别的年份的值顶替。</p></div>`;
  }
  const ready=readyRows(record), pending=pendingRows(record);
  const latest=ready.length?ready[ready.length-1]:null;
  return `<div class="panel" id="wacc-history-panel">
   <div class="section-head"><div>
    <h3>逐年资金成本与价值创造</h3>
    <p class="small muted">每一年的 WACC 都按那一年的市场数据重算 —— 不是把今天的一个数套在历史上。</p></div>
    <span class="small muted">算得出 ${ready.length}/${(record.years||[]).length} 个年度 · 计算于 ${esc(record.computed_at||'时间待核')}</span></div>
   ${latest?`<div class="wacc-latest">
    <div><span>最新年度</span><strong>${esc(latest.year)} 年</strong></div>
    <div><span>当年 WACC</span><strong>${pct(latest.wacc_pct)}</strong></div>
    <div><span>当年 ROIC</span><strong>${pct(latest.roic_pct)}</strong></div>
    <div><span>差额</span><strong class="${latest.spread_pct>=0?'wacc-pos':'wacc-neg'}">${isNum(latest.spread_pct)?(latest.spread_pct>=0?'+':'')+num(latest.spread_pct)+' 个百分点':'—'}</strong></div>
   </div>`:''}
   <div class="wacc-chart-block">
    <h4>逐年 WACC、ROIC 与差额</h4>
    <p class="small muted">柱子是「当年 ROIC － 当年 WACC」：正数代表当年创造了价值，负数代表毁灭价值（绿为正、红为负）。两条线是各自当年的数，悬停可看当年的完整构成。</p>
    <div id="wacc-history-chart" class="wacc-history-chart" role="img" aria-label="逐年资金成本、ROIC 与差额对照图"></div></div>
   ${compositionTable(ready)}
   ${pendingList(pending)}
   <div class="notice"><strong>这些数字的口径与边界</strong>
    <p class="small">无风险利率与税前债务成本取中债收益率曲线（${esc((record.benchmark||{}).name||'中债曲线')}）该年最后一个交易日；股权风险溢价由沪深300 官方 PE_TTM 反推的盈利收益率减去 Rf 得出，是市场隐含口径，<b>不是官方发布的股权风险溢价</b>；β 是个股前复权日收益率对沪深300 日收益率的回归，窗口截止到当年最后一个交易日，样本数与 R² 都列在表里；股权市值用当年年末<b>未复权</b>收盘价乘当年年报期末股本；有息负债用当年年报账面值代替市场价值；税率用当年年报有效税率。</p>
    <p class="small muted">WACC 本身没有任何官方发布的版本，它是研究者对资金成本的估计。逐年算出来的数逐年都不同，这正是它的用处：把「今天的钱有多贵」换回「那一年钱有多贵」。但要注意股权溢价是从估值反推的，市场估值极高的年份它会接近甚至低于零，那几年的 WACC 偏低、只能当下限看，页面会标出「口径失真」。缺数据的年度不参与任何对照，也不按零算。</p>
   </div>
  </div>`;
 }

 // ── 图表 ──────────────────────────────────────────────────────────────────
 function option(record){
  const rows=readyRows(record);
  const years=rows.map(row=>String(row.year));
  const spread=rows.map(row=>isNum(row.spread_pct)?Number(row.spread_pct):null);
  const flagged=rows.filter(row=>row.premium_note).map(row=>String(row.year));
  // 图例色块要跟柱子实际颜色一致：全是正数用绿、全是负数用红、正负混合用中性灰，
  // 否则图例挂一个蓝色方块、柱子是绿的，读起来会以为不是同一个东西。
  const signs=spread.filter(value=>value!=null).map(value=>value>=0?1:-1);
  const legendColor=!signs.length?'#2b7657':signs.every(value=>value>0)?'#2b7657':signs.every(value=>value<0)?'#bb6b5a':'#8a9a8f';
  return {
   animation:false,
   grid:{left:58,right:24,top:30,bottom:44},
   legend:{data:['当年 WACC','当年 ROIC',{name:'差额',itemStyle:{color:legendColor}}],top:2,itemWidth:14,itemHeight:8,textStyle:{color:'#4a5a51',fontSize:11}},
   tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:'#fffdf9',borderColor:'#e0e6df',textStyle:{color:'#20372f',fontSize:12},
    formatter:params=>{
     if(!Array.isArray(params)||!params.length)return '';
     const year=params[0].axisValue;
     const row=rows.find(item=>String(item.year)===year);
     if(!row)return '';
     const parts=[`<b>${esc(row.year)} 年</b>`,
      `当年 WACC ${pct(row.wacc_pct)}`,`当年 ROIC ${pct(row.roic_pct)}`,
      `差额 ${isNum(row.spread_pct)?(row.spread_pct>=0?'+':'')+num(row.spread_pct)+' 个百分点':'—'}`,
      `股权市值 ${yiText(row.equity)}｜股权占比 ${pct(row.equity_weight_pct,1)}`,
      `Rf ${pct(row.rf_pct)}｜β ${isNum(row.beta)?num(row.beta,3):'—'}`,
      `股权溢价 ${pct(row.premium_pct)}｜股权成本 ${pct(row.cost_of_equity_pct)}`,
      `税前债务成本 ${pct(row.debt_cost_pct)}｜有效税率 ${pct(row.tax_rate_pct)}`];
     if(row.premium_note)parts.push(`<span class="wacc-warn-text">${esc(row.premium_note)}</span>`);
     return parts.join('<br>');
    }},
   xAxis:{type:'category',data:years,
    axisLabel:{fontSize:10,color:'#829087',rotate:years.length>12?45:0},
    axisLine:{lineStyle:{color:'#e0e6df'}},axisTick:{show:false}},
   yAxis:{type:'value',name:'%',nameTextStyle:{color:'#829087',fontSize:11},
    axisLabel:{fontSize:10,color:'#829087',formatter:value=>num(value,0)},
    splitLine:{lineStyle:{color:'#eef1ec'}},axisLine:{show:false}},
   series:[
    {name:'差额',type:'bar',data:spread,barMaxWidth:22,yAxisIndex:0,
     itemStyle:{color:params=>{const value=params.value;return value!=null&&value>=0?'#2b7657':'#bb6b5a';}},
     markPoint:{symbolSize:0,label:{show:false},
      data:flagged.map(year=>({coord:[year,0],value:'',itemStyle:{color:'transparent'}}))}},
    {name:'当年 WACC',type:'line',smooth:false,showSymbol:true,symbolSize:6,connectNulls:false,
     lineStyle:{width:2.5,color:'#2b7657'},itemStyle:{color:'#2b7657'},
     data:rows.map(row=>isNum(row.wacc_pct)?Number(row.wacc_pct):null)},
    {name:'当年 ROIC',type:'line',smooth:false,showSymbol:true,symbolSize:6,connectNulls:false,
     lineStyle:{width:2.5,color:'#bb9558'},itemStyle:{color:'#bb9558'},
     data:rows.map(row=>isNum(row.roic_pct)?Number(row.roic_pct):null)}]};
 }

 function renderCharts(record){
  if(!record||record.status!=='available'||!window.echarts)return;
  const host=document.getElementById('wacc-history-chart');
  if(!host)return;
  const chart=window.echarts.init(host);
  chart.setOption(option(record));
  charts.push(chart);
 }

 function disposeCharts(){for(const chart of charts){try{chart.dispose();}catch{}}charts.length=0;}
 function resizeCharts(){for(const chart of charts){try{chart.resize();}catch{}}}

 return {panel,renderCharts,disposeCharts,resizeCharts,yearMap,readyRows,pendingRows,option};
})();
