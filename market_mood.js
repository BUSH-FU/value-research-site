'use strict';

// 市场情绪（市场先生状态）：把五项公开指标换算成 0～100 的历史分位，
// 再把落点画在情绪带里，并标出当前观察对象落在哪一段。
//
// 三条硬规矩：
// 1. 数字只有一种来源：服务器算好的真实读数。没有取到就写「未取得」，不用示例值顶替。
// 2. 区间和阈值必须画成图，并且标出落点，不靠文字描述让人自己换算。
// 3. 颜色与宽度一律走 CSS 类或 CSSOM 赋值：服务器 CSP 是 style-src 'self'，
//    行内 style 属性会被浏览器静默忽略（这个坑本项目已经踩过三次）。
window.MarketMood = (() => {
 const SERIES_COLORS = {valuation:'#2f6f5c', turnover:'#4f7d45', volatility:'#b79655', drawdown:'#c07a4a', leverage:'#a35a4b'};
 const COMPOSITE_COLOR = '#20372f';
 const charts = [];
 const VALUE_DIGITS = {'倍':2, '%':2, '亿元':0};
 const isNum = value => value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value));
 const score1 = value => isNum(value)?Number(value).toFixed(1):'—';
 const valueText = (value,unit) => isNum(value)?num(Number(value), VALUE_DIGITS[unit]===undefined?2:VALUE_DIGITS[unit])+(unit||''):'—';
 const pctText = value => isNum(value)?(Number(value)>=0?'+':'')+num(Number(value),1)+' 个分位点':'—';

 function bandFor(score,bands){
  if(!isNum(score)||!Array.isArray(bands))return null;
  for(const band of bands){if(Number(score)>=Number(band.from)&&Number(score)<Number(band.to))return band;}
  return bands[bands.length-1]||null;
 }

 // 情绪带刻度尺：5 段按实际区间宽度铺开，宽度与底色都按数据用 CSSOM 赋值，
 // 指针落在当前读数上，直接标出落在哪一段。
 function bandStrip(mood,score){
  const bands=mood?.bands||[];
  if(!bands.length)return '';
  const segments=bands.map((band,index)=>`<span class="mood-band" data-mood-band="${index}" title="${esc(band.label)}（${esc(band.from)}～${esc(band.to)}）">${esc(band.label)}</span>`).join('');
  return `<div class="mood-band-strip" data-mood-strip><div class="mood-band-scale">${segments}</div><span class="mood-band-pointer" data-mood-pointer aria-hidden="true"></span></div>`;
 }

 // CSSOM 赋值：宽度与颜色都来自后端数据，避免前端写死一份分段常量。
 // 摘要卡与精选标的卡各有一条刻度尺，两条都要上色。
 function paintBandStrip(mood){
  const bands=mood?.bands||[];
  const total=bands.reduce((sum,band)=>sum+(Number(band.to)-Number(band.from)),0)||100;
  for(const strip of document.querySelectorAll('[data-mood-strip]')){
   for(const element of strip.querySelectorAll('[data-mood-band]')){
    const band=bands[Number(element.dataset.moodBand)];
    if(!band)continue;
    element.style.width=((Number(band.to)-Number(band.from))/total*100)+'%';
    element.style.background=band.color;
    element.style.color=band.text;
   }
   const pointer=strip.querySelector('[data-mood-pointer]');
   if(pointer){
    const score=mood?.composite?.[mood?.primary_window||'10y']?.score;
    const band=bandFor(score,bands);
    pointer.style.left=(isNum(score)?Math.max(0,Math.min(100,Number(score)))+'%':'0%');
    pointer.style.background=band?band.text:'#829087';
    pointer.style.display=isNum(score)?'':'none';
   }
  }
 }

 function summaryCard(mood){
  const windowKey=mood?.primary_window||'10y';
  const composite=mood?.composite?.[windowKey]||{};
  const band=composite.band||bandFor(composite.score,mood?.bands);
  const other=(mood?.windows||[]).find(item=>item.key!==windowKey);
  const otherReading=other?mood?.composite?.[other.key]:null;
  const rows=(mood?.indicators||[]).map(item=>`<span class="mood-chip"><b>${esc(item.label.replace('分位',''))}</b>${score1(item.primary_score)}</span>`).join('');
  return `<div class="mood-summary" data-mood-summary>
   <div class="mood-summary-head"><div><span class="eyebrow">MARKET MOOD · ${esc(mood?.benchmark?.name||'沪深300')}</span><h3>市场整体读数</h3></div><output class="mood-score" data-mood-score>${score1(composite.score)}</output></div>
   <p class="mood-band-line">落在 <strong>${esc(band?.label||'待补')}</strong> 段（${esc(band?.from??'—')}～${esc(band?.to??'—')}）：${esc(band?.meaning||'数据未取得，不推测落点。')}</p>
   ${bandStrip(mood,composite.score)}
   <div class="mood-chips">${rows}</div>
   <p class="small muted">${esc(mood?.windows?.find(item=>item.key===windowKey)?.label||'主窗口')}历史分位（主窗口，样本取自实际交易日）；${other&&otherReading?`${esc(other.label)}读数 ${score1(otherReading.score)}（${esc(otherReading.band?.label||'待补')}）`:''}。数据日期 ${esc((mood?.indicators||[])[0]?.trade_date||'待补')} · 基准 ${esc(mood?.benchmark?.name||'沪深300')}（${esc(mood?.benchmark?.provider||'')}）。</p>
  </div>`;
 }

 function detailTable(mood){
  const windowKey=mood?.primary_window||'10y';
  const composite=mood?.composite?.[windowKey]||{};
  const windows=mood?.windows||[];
  const shortWindow=windows.find(item=>item.key!==windowKey);
  const longWindow=windows.find(item=>item.key===windowKey);
  const indicatorRows=(mood?.indicators||[]).map(item=>{
   const shortScore=shortWindow?item.windows?.[shortWindow.key]?.score:null;
   const longScore=longWindow?item.windows?.[longWindow.key]?.score:null;
   return `<tr><td><strong>${esc(item.label)}</strong><br><span class="small muted">${esc(item.detail)} · ${esc(item.reading)}</span></td>
    <td>${esc(valueText(item.value,item.unit))}<br><span class="small muted">${esc(item.trade_date||'待补')}</span></td>
    <td>${item.primary_score==null?'<span class="muted">未取得</span>':`<span class="pill">${esc(item.primary_band?.label||'—')}</span> <strong>${score1(item.primary_score)}</strong>`}</td>
    <td>${shortScore==null?'—':score1(shortScore)}</td>
    <td>${longScore==null?'—':score1(longScore)}</td>
    <td class="small muted">${esc(item.direction?.text||'')}</td>
    <td class="small muted">${esc(item.source)}<br>${esc(item.note||'')}</td></tr>`;
  }).join('');
  const compositeRow=`<tr class="mood-row-total"><td><strong>市场整体（中位数）</strong><br><span class="small muted">五项指标分位的中位数</span></td><td>—</td><td>${composite.score==null?'—':`<span class="pill">${esc(composite.band?.label||'—')}</span> <strong>${score1(composite.score)}</strong>`}</td><td>${shortWindow?score1(mood?.composite?.[shortWindow.key]?.score):'—'}</td><td>${longWindow?score1(mood?.composite?.[longWindow.key]?.score):'—'}</td><td class="small muted">${esc((mood?.composite?.[windowKey]?.missing||[]).length?'未纳入：'+mood.composite[windowKey].missing.join('、'):'五项全部纳入')}</td><td class="small muted">中位数抗离群值：单项跳到极端不会把整体读数带跑</td></tr>`;
  return `<div class="scroll"><table class="mood-table"><thead><tr><th>指标</th><th>当前值</th><th>主窗口落点</th><th>${esc(shortWindow?.label||'较短窗口分位')}</th><th>${esc(longWindow?.label||'较长窗口分位')}</th><th>方向</th><th>来源与口径</th></tr></thead><tbody>${compositeRow}${indicatorRows}</tbody></table></div>`;
 }

 function render(mood){
  if(!mood||mood.status!=='available'){
   return `<div class="panel"><h3>市场情绪数据未取得</h3><p class="muted">${esc(mood?.message||'尚未取得市场情绪数据。打开本页会重新取一次公开数据。')}</p><p class="small muted">本页只使用交易所与指数公司的公开数据：沪深300 指数估值与行情、沪深两市两融余额。取不到哪一项就在明细表里标明，不做推测。</p></div>`;
  }
  const windowKey=mood.primary_window||'10y';
  const history=mood.history||[];
  const bands=mood.bands||[];
  return `<div class="mood-layout">
   ${summaryCard(mood)}
   <div class="panel"><div class="section-head"><div><h3>五项指标落点图</h3><p class="small muted">横轴是各指标当前值在 ${esc((mood.windows||[]).find(w=>w.key===windowKey)?.label||'')}窗口里的历史分位（0～100）。背景色带是情绪分段；每个点的颜色就是它所在的那一段。</p></div></div>
    <div id="mood-landing-chart" class="mood-chart mood-chart-landing" role="img" aria-label="五项市场情绪指标与市场整体的当前落点"></div>
    <div id="mood-landing-detail" class="chart-selection" aria-live="polite">点击任意一个点，查看该指标的当前值、分位与所在分段。</div></div>
   <div class="panel"><div class="section-head"><div><h3>近 5 年情绪轨迹</h3><p class="small muted">每周取一点，画的是各指标在同一窗口口径下的历史分位。背景色带是情绪分段。综合线是五项分位的中位数。</p></div></div>
    <div id="mood-history-chart" class="mood-chart mood-chart-history" role="img" aria-label="近 5 年各指标历史分位曲线"></div></div>
   <div class="panel"><div class="section-head"><div><h3>指标明细</h3><p class="small muted">每项都标了当前值、两个窗口的分位、方向与数据来源。分位对窗口敏感，所以两个窗口都列出来。</p></div></div>
    ${detailTable(mood)}</div>
   <div class="panel notice"><strong>这些数字能说明什么，不能说明什么</strong><p class="small">${esc(mood.disclaimer||'')}</p><p class="small muted">情绪分段阈值（0～15 / 15～35 / 35～65 / 65～85 / 85～100）是我们自定的阅读标准，不是任何机构公布的情绪指数，也不参与本工作台的任何自动筛选。</p></div>
  </div>`;
 }

 // 精选标的顶部的一张紧凑摘要卡：整体读数 + 落点 + 五项分位 + 情绪带指针。
 function renderPoolCard(mood){
  if(!mood||mood.status!=='available'){
   return `<div class="mood-pool-card muted" data-mood-pool-card><div><strong>市场情绪 · 市场先生状态</strong><p class="small">${esc(mood?.message||'市场情绪数据尚未取得，打开「市场情绪」页即可更新。')}</p></div></div>`;
  }
  const windowKey=mood.primary_window||'10y';
  const composite=mood?.composite?.[windowKey]||{};
  const band=composite.band||bandFor(composite.score,mood?.bands);
  const chips=(mood?.indicators||[]).map(item=>`<span class="mood-chip"><b>${esc(item.label.replace('分位',''))}</b>${score1(item.primary_score)}</span>`).join('');
  return `<div class="mood-pool-card" data-mood-pool-card><div class="mood-pool-main"><div><span class="eyebrow">市场情绪 · 市场先生状态</span><h3>${esc(mood?.benchmark?.name||'沪深300')} 整体读数 <span class="pill">${esc(band?.label||'待补')}</span></h3><p class="small muted">${esc(band?.meaning||'')}</p></div><output class="mood-score">${score1(composite.score)}</output></div>
   ${bandStrip(mood,composite.score)}
   <div class="mood-chips">${chips}</div>
   <p class="small muted">数据日期 ${esc((mood?.indicators||[])[0]?.trade_date||'待补')} · 主窗口 ${esc((mood?.windows||[]).find(w=>w.key===windowKey)?.label||'')}历史分位 · 分位只说明市场比过去热还是冷，不是买卖信号。</p></div>`;
 }

 // ── 图表 ────────────────────────────────────────────────────────────────
 function landingOption(mood){
  const bands=mood?.bands||[];
  const indicators=mood?.indicators||[];
  const windowKey=mood?.primary_window||'10y';
  const composite=mood?.composite?.[windowKey]||{};
  const rows=['市场整体',...indicators.map(item=>item.label)];
  const points=[{
   name:'市场整体', value:[isNum(composite.score)?Number(composite.score):null,0],
   score:composite.score, band:composite.band,
   detail:'五项指标分位的中位数',
  },...indicators.map((item,index)=>({
   name:item.label, value:[isNum(item.primary_score)?Number(item.primary_score):null,index+1],
   score:item.primary_score, band:item.primary_band,
   detail:`${item.detail} · ${valueText(item.value,item.unit)} · ${item.trade_date||'待补'}`,
  }))];
  return {
   animation:false,
   grid:{left:104,right:56,top:30,bottom:46},
   tooltip:{trigger:'item',backgroundColor:'#fffdf9',borderColor:'#e0e6df',textStyle:{color:'#20372f',fontSize:12},
    formatter:params=>{
     const point=params.data||{};
     const band=point.band||{};
     return `${esc(point.name||'')}<br>${esc(point.detail||'')}<br>分位 <b>${score1(point.score)}</b> · 落在「${esc(band.label||'待补')}」段（${esc(band.from??'—')}～${esc(band.to??'—')}）`;
    }},
   xAxis:{type:'value',min:0,max:100,interval:20,name:'贪婪度（历史分位 0～100）',nameLocation:'middle',nameGap:28,nameTextStyle:{fontSize:11,color:'#829087'},
    axisLabel:{fontSize:11,color:'#829087'},splitLine:{lineStyle:{color:'#eef1ec'}},axisLine:{show:false}},
   yAxis:{type:'category',inverse:true,data:rows,axisLabel:{fontSize:12,color:'#5b6b62'},axisLine:{show:false},axisTick:{show:false},splitLine:{show:false}},
   series:[{
    type:'scatter',name:'当前落点',
    data:points.map((point,index)=>({...point,itemStyle:{color:point.band?.text||'#829087',borderColor:'#ffffff',borderWidth:2},
     symbolSize:index===0?24:16})),
    label:{show:true,position:'right',distance:9,fontSize:11,color:'#5b6b62',
     formatter:params=>{const point=params.data||{};return index0Label(point);}},
    markArea:{silent:true,
     data:bands.map(band=>([{xAxis:Number(band.from),name:band.label,itemStyle:{color:band.color},label:{color:band.text}},{xAxis:Number(band.to)}])),
     label:{show:true,position:'insideTop',fontSize:11,distance:4,
      formatter:params=>params.name||''},
    },
   }],
  };
 }
 // 落点标签：市场整体那行连分段名一起标出来，其余只标分位。
 function index0Label(point){
  const score=score1(point.score);
  if(!isNum(point.score))return '';
  return point.name==='市场整体'?`${score} · ${point.band?.label||''}`:score;
 }

 function historyOption(mood){
  const bands=mood?.bands||[];
  const history=mood?.history||[];
  const dates=history.map(row=>row.date);
  const indicatorSeries=(mood?.indicators||[]).map(item=>({
   name:item.label,type:'line',smooth:false,showSymbol:false,symbol:'none',
   lineStyle:{width:1.6,color:SERIES_COLORS[item.key]||'#829087'},
   itemStyle:{color:SERIES_COLORS[item.key]||'#829087'},
   data:history.map(row=>isNum(row[item.key])?Number(row[item.key]):null),
  }));
  return {
   animation:false,
   grid:{left:52,right:26,top:58,bottom:52},
   legend:{top:0,left:0,itemGap:14,textStyle:{fontSize:11,color:'#5b6b62'},itemWidth:16,itemHeight:2},
   tooltip:{trigger:'axis',backgroundColor:'#fffdf9',borderColor:'#e0e6df',textStyle:{color:'#20372f',fontSize:12},
    formatter:params=>{
     if(!Array.isArray(params)||!params.length)return '';
     const date=params[0].axisValue;
     // marker 是 ECharts 生成的彩色圆点（HTML），不能转义，否则 tooltip 里会显示成一串源码；
     // 系列名要单独带上 —— marker 只占圆点，不含名字，漏了就只剩一个没有标签的点。
     // 「市场整体」不列在这里：底部汇总行会带上它和所在分段，重复一遍反而乱。
     const rows=params.filter(item=>item.value!=null&&item.seriesName!=='市场整体')
      .map(item=>`${item.marker||''}${esc(item.seriesName)}：<b>${score1(item.value)}</b>`);
     const composite=history.find(row=>row.date===date);
     const band=bandFor(composite?.composite,mood?.bands);
     return `${esc(date)}<br>${rows.join('<br>')}<br>市场整体：<b>${score1(composite?.composite)}</b>（${esc(band?.label||'待补')}）`;
    }},
   xAxis:{type:'category',data:dates,boundaryGap:false,
    axisLabel:{fontSize:10,color:'#829087',formatter:value=>String(value).slice(0,7)},
    axisLine:{lineStyle:{color:'#e0e6df'}},axisTick:{show:false}},
   yAxis:{type:'value',min:0,max:100,interval:25,name:'历史分位',nameGap:14,nameTextStyle:{fontSize:11,color:'#829087'},
    axisLabel:{fontSize:11,color:'#829087'},splitLine:{lineStyle:{color:'#eef1ec'}},axisLine:{show:false}},
   series:[{
    name:'市场整体',type:'line',smooth:false,showSymbol:false,symbol:'none',z:5,
    lineStyle:{width:3,color:COMPOSITE_COLOR},itemStyle:{color:COMPOSITE_COLOR},
    data:history.map(row=>isNum(row.composite)?Number(row.composite):null),
    markArea:{silent:true,
     data:bands.map(band=>([{yAxis:Number(band.from),name:band.label,itemStyle:{color:band.color},label:{color:band.text}},{yAxis:Number(band.to)}])),
     label:{show:true,position:'insideStartTop',fontSize:10,distance:4,formatter:params=>params.name||''},
    },
   },...indicatorSeries],
  };
 }

 function renderCharts(mood){
  disposeCharts();
  if(!mood||mood.status!=='available'||!window.echarts)return;
  const landing=document.getElementById('mood-landing-chart');
  if(landing){
   const chart=echarts.init(landing);
   chart.setOption(landingOption(mood));
   chart.on('click',params=>{
    const detail=document.getElementById('mood-landing-detail');
    const point=params.data||{};
    const band=point.band||{};
    if(detail){
     detail.innerHTML=`<strong>${esc(point.name||'')}</strong><span>${esc(point.detail||'')}；分位 <b>${score1(point.score)}</b>，落在「${esc(band.label||'待补')}」段（${esc(band.from??'—')}～${esc(band.to??'—')}）——${esc(band.meaning||'')}</span>`;
    }
   });
   charts.push(chart);
  }
  const history=document.getElementById('mood-history-chart');
  if(history){
   const chart=echarts.init(history);
   chart.setOption(historyOption(mood));
   charts.push(chart);
  }
 }

 function disposeCharts(){for(const chart of charts){try{chart.dispose();}catch{}}charts.length=0;}
 function resizeCharts(){for(const chart of charts){try{chart.resize();}catch{}}}

 return {render,renderPoolCard,renderCharts,disposeCharts,resizeCharts,landingOption,historyOption,bandFor,paintBandStrip,summaryCard};
})();
