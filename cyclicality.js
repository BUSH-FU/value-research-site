'use strict';

// 周期属性与周期位置：判断一家公司是不是周期性企业、整个周期长什么样、
// 现在走到了周期的哪一段。
//
// 三条硬规矩（和市场情绪那页一致）：
// 1. 数字只有一种来源：服务器算好的真实读数。缺数据写「待补」，不用示例值顶替。
// 2. 区间与阈值必须画成图，并且标出当前观察对象落在哪一段。
// 3. 颜色与宽度一律走 CSS 类或 CSSOM 赋值 —— 服务器 CSP 是 style-src 'self'，
//    行内 style 属性会被浏览器静默忽略（这个坑本项目已经踩过三次）。
window.Cyclicality = (() => {
 const charts = [];
 const isNum = value => value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value));
 const ratioText = value => isNum(value)?num(Number(value),2)+'×':'—';
 const pctText = value => isNum(value)?num(Number(value),1)+'%':'—';
 const cvText = value => isNum(value)?num(Number(value),3):'—';
 const dateText = value => String(value||'').slice(0,10);

 // 位置刻度尺的三段：自定的阅读标准，页面上要写明。
 const POSITION_BANDS = [
  {from:0,to:30,label:'偏低',color:'#e8f0ea',text:'#3f6b55'},
  {from:30,to:70,label:'中位',color:'#f3efe2',text:'#8a6f32'},
  {from:70,to:100,label:'偏高',color:'#f6e4e0',text:'#9c4f42'},
 ];

 function bandFor(value){
  if(!isNum(value))return null;
  const score=Math.max(0,Math.min(100,Number(value)));
  for(const band of POSITION_BANDS){if(score>=band.from&&score<band.to)return band;}
  return POSITION_BANDS[POSITION_BANDS.length-1];
 }

 // ── 优选池表格里的「周期属性」单元格 ──────────────────────────────────────
 function poolCell(record){
  if(!record||record.status!=='available'){
   return `<div class="cyc-cell"><span class="muted">${esc((record&&record.message)||'周期数据待补')}</span></div>`;
  }
  const ratio=isNum(record.amplitude_ratio)?ratioText(record.amplitude_ratio):'—';
  return `<div class="cyc-cell">
   <span class="pill cyc-pill cyc-${esc(record.business_level||'unknown')}">${esc(record.business_label||'待补')}</span>
   <span class="cyc-stage">${esc(record.stage_label||'位置待补')}</span>
   <span class="small muted">${esc(record.industry_name||'')}｜价格${esc((record.price_label||'待补').replace('价格',''))} ${ratio}</span>
  </div>`;
 }

 // ── 位置刻度尺 ────────────────────────────────────────────────────────────
 // 0～100 的轨道，三段底色 + 指针直接落在当前读数上，并写出落在哪一段。
 function positionRuler(rows){
  const items=rows.map(row=>`<div class="cyc-ruler-row">
    <span class="cyc-ruler-label">${esc(row.label)}</span>
    <span class="cyc-ruler-track" data-cyc-track="${esc(row.key)}">
     ${POSITION_BANDS.map(band=>`<i class="cyc-ruler-band" data-cyc-band="${esc(row.key)}" data-from="${band.from}" data-to="${band.to}"></i>`).join('')}
     <i class="cyc-ruler-pointer" data-cyc-pointer="${esc(row.key)}"></i>
    </span>
    <span class="cyc-ruler-value" data-cyc-value="${esc(row.key)}">${isNum(row.value)?num(Number(row.value),1):'待补'}</span>
    <span class="cyc-ruler-band-label" data-cyc-band-label="${esc(row.key)}">${esc(row.bandLabel||'待补')}</span>
  </div>`).join('');
  return `<div class="cyc-rulers">${items}</div>`;
 }

 // 刻度尺的宽度与底色按数据用 CSSOM 赋值：段落区间来自后端，前端不写死另一份。
 function paintRulers(record){
  const profit=(record?.company||{}).profit||{};
  const price=(record?.company||{}).price||{};
  const positions=price.positions||{};
  const rows={
   margin:{label:'净利率分位（近 10 年）',value:profit.net_margin_percentile,bandLabel:bandFor(profit.net_margin_percentile)?.label},
   price3:{label:'股价分位（近 3 年）',value:(positions['近 3 年']||{}).percentile,bandLabel:bandFor((positions['近 3 年']||{}).percentile)?.label},
   price5:{label:'股价分位（近 5 年）',value:(positions['近 5 年']||{}).percentile,bandLabel:bandFor((positions['近 5 年']||{}).percentile)?.label},
  };
  for(const [key,row] of Object.entries(rows)){
   for(const element of document.querySelectorAll(`[data-cyc-band="${key}"]`)){
    const from=Number(element.dataset.from),to=Number(element.dataset.to);
    const band=POSITION_BANDS.find(item=>item.from===from&&item.to===to);
    if(!band)continue;
    element.style.left=from+'%';
    element.style.width=(to-from)+'%';
    element.style.background=band.color;
   }
   const pointer=document.querySelector(`[data-cyc-pointer="${key}"]`);
   if(pointer){
    const position=isNum(row.value)?Number(Math.max(0,Math.min(100,Number(row.value))).toFixed(1)):0;
    pointer.style.left=position+'%';
    pointer.style.display=isNum(row.value)?'':'none';
    const band=bandFor(row.value);
    pointer.style.background=band?band.text:'#829087';
   }
   const label=document.querySelector(`[data-cyc-band-label="${key}"]`);
   if(label)label.textContent=row.bandLabel||'待补';
   const value=document.querySelector(`[data-cyc-value="${key}"]`);
   if(value)value.textContent=isNum(row.value)?num(Number(row.value),1):'待补';
  }
 }

 // ── 公司页面板 ────────────────────────────────────────────────────────────
 function verdictCard(record){
  const verdict=record.verdict||{};
  const cycle=record.industry_cycle||{};
  const profit=(record.company||{}).profit||{};
  const benchmark=record.benchmark||{};
  return `<div class="cyc-verdict">
   <div class="cyc-verdict-item"><span class="small muted">业务周期属性</span>
    <strong class="cyc-verdict-value">${esc(verdict.business_label||'待补')}</strong>
    <span class="small muted">${esc(verdict.business_meaning||'')}</span>
    <span class="small muted">证据：十年 ROE 变异系数 ${cvText(verdict.roe_cv)}（${isNum(profit.roe_samples)?profit.roe_samples:'—'} 个年度）</span></div>
   <div class="cyc-verdict-item"><span class="small muted">行业价格周期强度</span>
    <strong class="cyc-verdict-value">${esc(verdict.price_label||'待补')}</strong>
    <span class="small muted">${esc(verdict.price_meaning||'')}</span>
    <span class="small muted">证据：典型一轮幅度 ${pctText(cycle.amplitude_pct)}，是全市场中位数 ${pctText(benchmark.median_pct)} 的 ${ratioText(verdict.amplitude_ratio)}（基准样本 ${isNum(benchmark.samples)?benchmark.samples:'—'} 个行业）</span></div>
   <div class="cyc-verdict-item"><span class="small muted">现在处在周期的哪一段</span>
    <strong class="cyc-verdict-value">${esc(verdict.stage_label||'位置待补')}</strong>
    <span class="small muted">${esc(verdict.industry_stage||'行业阶段待补')}</span>
    <span class="small muted">${esc((record.industry||{}).l1_name||'')} · ${esc((record.industry||{}).l2_name||'')}（${esc((record.industry||{}).l2_code||'')}）</span></div>
  </div>`;
 }

 function evidenceTable(record){
  const cycle=record.industry_cycle||{};
  const profit=(record.company||{}).profit||{};
  const price=(record.company||{}).price||{};
  const positions=price.positions||{};
  const period=cycle.period||{};
  const pe=cycle.pe||{};
  const correlation=(record.company||{}).correlation||{};
  const benchmark=record.benchmark||{};
  const rows=[
   ['业务周期属性', `${esc(record.verdict?.business_label||'待补')}`, `十年 ROE 变异系数 ${cvText(record.verdict?.roe_cv)}；净利率变异系数 ${cvText(profit.net_margin_cv)}。ROE 样本 ${isNum(profit.roe_samples)?profit.roe_samples:'—'} 个年度（近 10 年）`],
   ['行业价格周期强度', `${esc(record.verdict?.price_label||'待补')} ${ratioText(record.verdict?.amplitude_ratio)}`, `行业指数典型一轮幅度 ${pctText(cycle.amplitude_pct)}（3 年滚动峰谷幅度中位数）；全市场申万二级行业中位数 ${pctText(benchmark.median_pct)}，样本 ${isNum(benchmark.samples)?benchmark.samples:'—'} 个行业`],
   ['行业主周期', isNum(period.years)?`${num(period.years,2)} 年（${period.days} 个交易日）`:'待补', isNum(period.explained)?`该周期解释了 ${num(period.explained*100,1)}% 的去趋势波动；解释得越低，说明样本里周期越不明显`:'待补'],
   ['行业 PE', isNum(pe.latest)?num(pe.latest,1):'待补', isNum(pe.percentile)?`在行业自身历史里处于 ${num(pe.percentile,1)}% 分位（区间 ${num(pe.min,1)}～${num(pe.max,1)}）`:'待补'],
   ['净利率位置', isNum(profit.net_margin_pct)?`${num(profit.net_margin_pct,2)}%（${profit.year||'—'} 年）`:'待补', isNum(profit.net_margin_percentile)?`近 10 年分位 ${num(profit.net_margin_percentile,1)}%，样本 ${profit.net_margin_samples} 个年度`:'待补'],
   ['ROE 位置', isNum(profit.roe_pct)?`${num(profit.roe_pct,2)}%`:'待补', isNum(profit.roe_percentile)?`近 10 年分位 ${num(profit.roe_percentile,1)}%，样本 ${profit.roe_samples} 个年度`:'待补'],
   ['股价位置', isNum(price.close)?`¥${num(price.close,2)}（${dateText(price.date)}）`:'待补', Object.entries(positions).map(([label,item])=>`${label}分位 ${isNum(item.percentile)?num(item.percentile,1)+'%':'待补'}（${isNum(item.samples)?item.samples:'—'} 个交易日）`).join('；')],
   ['与行业同步性', isNum(correlation.value)?num(correlation.value,3):'待补', `${esc(correlation.note||'')}；重叠年度 ${isNum(correlation.samples)?correlation.samples:'—'} 个`],
   ['当前所处段落', esc(record.verdict?.industry_stage||'待补'), isNum(cycle.stage?.progress)?`段内进度 ${num(cycle.stage.progress*100,1)}%；距上轮高点 ${pctText(cycle.stage?.from_peak_pct)}，距上轮低点 ${pctText(cycle.stage?.from_trough_pct)}`:'待补'],
  ];
  return `<div class="scroll"><table class="cyc-table"><thead><tr><th>证据</th><th>数值</th><th>口径与来源</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row[0]}</td><td><strong>${row[1]}</strong></td><td class="small muted">${row[2]}</td></tr>`).join('')}</tbody></table></div>`;
 }

 function panel(record){
  if(!record){
   return `<div class="panel" id="cyc-panel"><h3>周期属性与周期位置</h3><p class="muted">正在读取周期数据…</p></div>`;
  }
  if(record.status!=='available'){
   return `<div class="panel" id="cyc-panel"><h3>周期属性与周期位置</h3><p class="muted">${esc(record.message||'周期数据尚未取得。')}</p><p class="small muted">周期判定需要申万行业分类与行业指数行情；缺哪一项就写明原因，不推测结果。</p></div>`;
  }
  const cycle=record.industry_cycle||{};
  const period=cycle.period||{};
  return `<div class="panel" id="cyc-panel">
   <div class="section-head"><div><h3>周期属性与周期位置</h3>
    <p class="small muted">业务周期属性看盈利自身摆动多大，行业价格周期强度看行业股价的典型一轮涨跌，两条线分开判断。</p></div>
    <span class="small muted">${esc((record.industry||{}).l2_name||'')} · ${esc(cycle.start||'')} 起 ${isNum(cycle.observations)?cycle.observations:'—'} 个交易日</span></div>
   ${verdictCard(record)}
   ${positionRuler([
    {key:'margin',label:'净利率分位（近 10 年）',value:((record.company||{}).profit||{}).net_margin_percentile},
    {key:'price3',label:'股价分位（近 3 年）',value:(((record.company||{}).price||{}).positions||{})['近 3 年']?.percentile},
    {key:'price5',label:'股价分位（近 5 年）',value:(((record.company||{}).price||{}).positions||{})['近 5 年']?.percentile},
   ])}
   <div class="cyc-charts">
    <div class="cyc-chart-block"><h4>① 行业周期曲线 · 申万二级行业指数</h4>
     <p class="small muted">▲ 是显著高点，▼ 是显著低点；灰色区间是当前这一段。右侧轴是行业 PE。</p>
     <div id="cyc-industry-chart" class="cyc-chart cyc-chart-industry" role="img" aria-label="行业指数收盘价曲线、显著峰谷与当前所处段落"></div></div>
    <div class="cyc-chart-block"><h4>② 公司盈利周期 · 净利率与 ROE</h4>
     <p class="small muted">柱子是净利率，折线是 ROE，都按年度取自年报原始数据。</p>
     <div id="cyc-profit-chart" class="cyc-chart cyc-chart-profit" role="img" aria-label="公司历年净利率与 ROE"></div></div>
    <div class="cyc-chart-block"><h4>③ 股价位置 · 近 5 年</h4>
     <p class="small muted">两条横线是近 3 年的最低价与最高价，当前价落在哪一段一眼可见。</p>
     <div id="cyc-price-chart" class="cyc-chart cyc-chart-price" role="img" aria-label="近 5 年收盘价与近 3 年高低区间"></div></div>
   </div>
   ${evidenceTable(record)}
   <div class="notice"><strong>这些数字能说明什么，不能说明什么</strong>
    <p class="small">${esc(record.boundary||'')}</p>
    <p class="small muted">主周期 ${isNum(period.years)?`${num(period.years,2)} 年`:'待补'}；行业指数覆盖的是资本市场对行业的定价，不是产品价格的产业周期。业务周期属性与价格周期强度的分档都是我们自定的阅读标准，不参与本工作台的任何自动筛选。</p></div>
  </div>`;
 }

 // ── 图表 ──────────────────────────────────────────────────────────────────
 function industryOption(record){
  const cycle=record.industry_cycle||{};
  const series=cycle.series||[];
  const dates=series.map(row=>row.date);
  const stage=cycle.stage||{};
  const peaks=(cycle.peaks||[]).map(item=>({coord:[item.date,item.value],value:item.value,name:'峰'}));
  const troughs=(cycle.troughs||[]).map(item=>({coord:[item.date,item.value],value:item.value,name:'谷'}));
  // 当前这一段：从上一个转折点画到现在，让「在哪一段」直接看得见。
  const segmentStart=stage.direction==='上行段'?(stage.last_trough||{}).date:(stage.last_peak||{}).date;
  const markArea=segmentStart&&dates.length?[[{xAxis:segmentStart},{xAxis:dates[dates.length-1]}]]:[];
  return {
   animation:false,
   grid:{left:56,right:54,top:24,bottom:40},
   tooltip:{trigger:'axis',backgroundColor:'#fffdf9',borderColor:'#e0e6df',textStyle:{color:'#20372f',fontSize:12},
    formatter:params=>{
     if(!Array.isArray(params)||!params.length)return '';
     const row=params[0].axisValue;
     const item=series.find(entry=>entry.date===row)||{};
     return `${esc(row)}<br>行业指数收盘 <b>${isNum(item.close)?num(item.close,2):'—'}</b>${isNum(item.pe)?`<br>行业 PE ${num(item.pe,1)}`:''}`;
    }},
   xAxis:{type:'category',data:dates,boundaryGap:false,
    axisLabel:{fontSize:10,color:'#829087',formatter:value=>String(value).slice(0,7)},
    axisLine:{lineStyle:{color:'#e0e6df'}},axisTick:{show:false}},
   yAxis:[
    {type:'value',scale:true,name:'收盘',nameTextStyle:{fontSize:11,color:'#829087'},
     axisLabel:{fontSize:10,color:'#829087'},splitLine:{lineStyle:{color:'#eef1ec'}},axisLine:{show:false}},
    {type:'value',scale:true,name:'PE',nameTextStyle:{fontSize:11,color:'#829087'},
     axisLabel:{fontSize:10,color:'#829087'},splitLine:{show:false},axisLine:{show:false}},
   ],
   series:[
    {name:'行业指数收盘',type:'line',showSymbol:false,symbol:'none',smooth:false,
     lineStyle:{width:1.8,color:'#2f6f5c'},itemStyle:{color:'#2f6f5c'},
     areaStyle:{color:'rgba(47,111,92,0.08)'},
     data:series.map(row=>row.close),
     markArea:{silent:true,data:markArea,itemStyle:{color:'rgba(47,111,92,0.10)'}},
     markPoint:{symbolSize:9,silent:true,data:peaks.map(item=>({...item,symbol:'pin',symbolSize:12,itemStyle:{color:'#c07a4a'},
       label:{fontSize:9,color:'#8a5a38',formatter:()=>'▲',position:'top'}}))
      .concat(troughs.map(item=>({...item,symbol:'pin',symbolSize:12,itemStyle:{color:'#4f7d45'},
       label:{fontSize:9,color:'#3c6035',formatter:()=>'▼',position:'bottom'}})))},
    },
    {name:'行业 PE',type:'line',yAxisIndex:1,showSymbol:false,symbol:'none',smooth:false,
     lineStyle:{width:1,color:'#b8a68a',type:'dashed'},itemStyle:{color:'#b8a68a'},
     data:series.map(row=>isNum(row.pe)?row.pe:null)},
    {name:'当前',type:'scatter',symbolSize:13,data:[{value:[dates[dates.length-1],series[series.length-1]?.close],
      itemStyle:{color:'#c0392b',borderColor:'#ffffff',borderWidth:2}}],
     label:{show:true,position:'top',distance:8,fontSize:11,color:'#c0392b',
      formatter:()=>isNum(series[series.length-1]?.close)?`当前 ${num(series[series.length-1].close,2)}`:''}},
   ],
  };
 }

 function profitOption(record){
  const annual=(record.company||{}).annual||[];
  const years=annual.map(row=>String(row.year));
  const margins=annual.map(row=>isNum(row.net_margin_pct)?row.net_margin_pct:null);
  const roes=annual.map(row=>isNum(row.roe)?row.roe:null);
  return {
   animation:false,
   grid:{left:52,right:48,top:24,bottom:34},
   tooltip:{trigger:'axis',backgroundColor:'#fffdf9',borderColor:'#e0e6df',textStyle:{color:'#20372f',fontSize:12},
    formatter:params=>{
     if(!Array.isArray(params)||!params.length)return '';
     const year=params[0].axisValue;
     const margin=margins[years.indexOf(year)];
     const roe=roes[years.indexOf(year)];
     return `${esc(year)} 年<br>净利率 <b>${isNum(margin)?num(margin,2)+'%':'—'}</b><br>ROE <b>${isNum(roe)?num(roe,2)+'%':'—'}</b>`;
    }},
   legend:{top:0,right:0,itemGap:12,textStyle:{fontSize:11,color:'#5b6b62'},itemWidth:14,itemHeight:8},
   xAxis:{type:'category',data:years,axisLabel:{fontSize:10,color:'#829087'},
    axisLine:{lineStyle:{color:'#e0e6df'}},axisTick:{show:false}},
   yAxis:[
    {type:'value',scale:true,name:'净利率 %',nameTextStyle:{fontSize:11,color:'#829087'},
     axisLabel:{fontSize:10,color:'#829087'},splitLine:{lineStyle:{color:'#eef1ec'}},axisLine:{show:false}},
    {type:'value',scale:true,name:'ROE %',nameTextStyle:{fontSize:11,color:'#829087'},
     axisLabel:{fontSize:10,color:'#829087'},splitLine:{show:false},axisLine:{show:false}},
   ],
   series:[
    {name:'净利率',type:'bar',yAxisIndex:0,data:margins,itemStyle:{color:'#c07a4a'},barMaxWidth:22},
    {name:'ROE',type:'line',yAxisIndex:1,data:roes,showSymbol:true,symbolSize:6,
     lineStyle:{width:2,color:'#2f6f5c'},itemStyle:{color:'#2f6f5c'}},
   ],
  };
 }

 function priceOption(record){
  const company=record.company||{};
  const positions=(company.price||{}).positions||{};
  const three=positions['近 3 年']||{};
  // 近 5 年日线随记录一起返回，用来把「股价落在哪一段」画出来。
  const history=(company.price||{}).history||[];
  const dates=history.map(row=>row.date);
  return {
   animation:false,
   grid:{left:56,right:26,top:24,bottom:40},
   tooltip:{trigger:'axis',backgroundColor:'#fffdf9',borderColor:'#e0e6df',textStyle:{color:'#20372f',fontSize:12},
    formatter:params=>{
     if(!Array.isArray(params)||!params.length)return '';
     const row=history[dates.indexOf(params[0].axisValue)]||{};
     return `${esc(params[0].axisValue)}<br>收盘 <b>${isNum(row.close)?num(row.close,2):'—'}</b>`;
    }},
   xAxis:{type:'category',data:dates,boundaryGap:false,
    axisLabel:{fontSize:10,color:'#829087',formatter:value=>String(value).slice(0,7)},
    axisLine:{lineStyle:{color:'#e0e6df'}},axisTick:{show:false}},
   yAxis:{type:'value',scale:true,axisLabel:{fontSize:10,color:'#829087'},
    splitLine:{lineStyle:{color:'#eef1ec'}},axisLine:{show:false}},
   series:[{
    name:'收盘价',type:'line',showSymbol:false,symbol:'none',smooth:false,
    lineStyle:{width:1.8,color:'#4f7d45'},itemStyle:{color:'#4f7d45'},
    areaStyle:{color:'rgba(79,125,69,0.08)'},
    data:history.map(row=>row.close),
    markLine:{silent:true,symbol:'none',lineStyle:{color:'#c9bda6',type:'dashed',width:1},
     // 标签靠左放：放右边会被画布边缘裁掉一半。
     label:{fontSize:10,color:'#8a7f68',position:'insideStartTop',formatter:params=>params.name},
     data:[
      ...(isNum(three.low)?[{yAxis:three.low,name:`近 3 年最低 ${num(three.low,2)}`}]:[]),
      ...(isNum(three.high)?[{yAxis:three.high,name:`近 3 年最高 ${num(three.high,2)}`}]:[]),
     ]},
   }],
  };
 }

 function renderCharts(record){
  disposeCharts();
  if(!record||record.status!=='available'||!window.echarts)return;
  paintRulers(record);
  const industry=document.getElementById('cyc-industry-chart');
  if(industry){
   const chart=echarts.init(industry);
   chart.setOption(industryOption(record));
   charts.push(chart);
  }
  const profit=document.getElementById('cyc-profit-chart');
  if(profit){
   const chart=echarts.init(profit);
   chart.setOption(profitOption(record));
   charts.push(chart);
  }
  const price=document.getElementById('cyc-price-chart');
  if(price){
   const chart=echarts.init(price);
   chart.setOption(priceOption(record));
   charts.push(chart);
  }
 }

 function disposeCharts(){for(const chart of charts){try{chart.dispose();}catch{}}charts.length=0;}
 function resizeCharts(){for(const chart of charts){try{chart.resize();}catch{}}}

 return {poolCell,panel,renderCharts,disposeCharts,resizeCharts,paintRulers,positionRuler,
  industryOption,profitOption,priceOption,bandFor};
})();
