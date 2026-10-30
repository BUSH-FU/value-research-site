'use strict';
let state, detail, selected, polling=false, graphMode='recent', graphObserver, historyCategory='all', currentView='mood';
// 周期属性与周期位置：单独取数。公司页按需拉一次完整记录（行业曲线 + 利润 + 股价）。
let cycleRecord=null, cycleLoading=false;
// 市场情绪（市场先生状态）：单独取数，不混进 /api/state，免得每次刷新都拖一份大 JSON。
let moodData=null, moodLoading=false, moodLoadedAt=0;
const MOOD_REFRESH_MS=300000;
// 批量测算：每股内在价值与安全边际。同样单独取数，服务端最多五分钟取一次。
let scenariosData=null, scenariosLoading=false, scenariosLoadedAt=0;
const SCENARIOS_REFRESH_MS=300000;
let companyOrigin='pool',companyScenarioBasis='median';
const KLINE_UP='#d4463f',KLINE_DOWN='#1aa08a';
let priceChart=null, priceChartObserver=null, klineRows=[], klineDays='all', klinePeriod='day', klineSelected=-1, klineMa={}, klinePending=false, klineAdjust='none';
// 复权口径：不复权用实际成交价；前复权把历史价折算到今天的价格单位；后复权把价格折算到今天以后的股本口径。
const KLINE_ADJUSTS=[['none','不复权'],['qfq','前复权'],['hfq','后复权']];
let poolSortKey='', poolSortDir=1;
// 均线：名称、颜色、可见性。点击均线行上的数字可隐藏/显示该条均线。
const KLINE_MA_KEYS=[['ma5','MA5','#e8912a'],['ma10','MA10','#d94a4a'],['ma20','MA20','#2f6fd0'],['ma30','MA30','#8b5cf6']];
let klineMaVisible={ma5:true,ma10:true,ma20:true,ma30:true};
let fcffSelectedYear=null;
// ROE 年度序列的上市以来全期均值：图表展示全部年度时用来对照；筛选口径的近十年均值另算。
let roeFullMean=null;
// 年度顺序：desc = 最新在前，asc = 最早在前。
let yearOrder='desc';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(x,n=2)=>x===null||x===undefined?'—':Number(x).toLocaleString('zh-CN',{maximumFractionDigits:n,minimumFractionDigits:n});
const yi=x=>x==null?'—':num(x/1e8);
const pct=x=>x==null?'—':num(x*100)+'%';
// 上市日期：19931119 读不出年份，改成「1993 年 11 月 19 日」。
const cnDate=value=>window.ValueReport?.fmtCnDate?window.ValueReport.fmtCnDate(value):value;
// 检查项数值的单位后缀：门槛与实测值都来自同一份政策，避免同一个数在两处读法不同。
const unitText=u=>u==='%'?'%':u==='个百分点'?' 个百分点':u==='年'?' 年':u==='倍'?' 倍':'';
const reviewFields=[['business','商业模式简单可理解'],['moat','护城河有事实支撑'],['roe_stability','十年 ROE 波动可接受'],['integrity','管理层诚信'],['related_transactions','无异常大额关联交易'],['delisting_risk','退市风险公告已核验']];
function feedback(message){$('feedback').textContent=message;}
async function api(path,body){const r=await fetch(path.startsWith('/api/')?path.slice(1):path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'请求失败');return data;}
function view(id){const inCompany=id==='research'||id==='valuation';$('company-workspace').hidden=!inCompany;for(const button of document.querySelectorAll('#company-workspace [data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===id));for(const el of document.querySelectorAll('.view'))el.hidden=el.id!==id;for(const el of document.querySelectorAll('.nav'))el.classList.toggle('active',el.dataset.view===(inCompany?companyOrigin:id));currentView=id;if(id==='research'&&window.echarts)requestAnimationFrame(()=>{const target=$('management-graph');if(target)echarts.getInstanceByDom(target)?.resize();ValueReport.resizeCharts();window.Cyclicality?.resizeCharts();window.WaccHistory?.resizeCharts();});if(id==='valuation')requestAnimationFrame(()=>{if(klinePending)renderPriceChart(klineDays,klinePeriod);else priceChart?.resize();});if(id==='mood'){loadMood();requestAnimationFrame(()=>{window.MarketMood?.renderCharts(moodData);});}if(id==='scenarios')loadScenarios();}
// 市场情绪取数：服务端按天缓存，这里最多五分钟取一次，免得轮询时反复拉。
async function loadMood(force){
 if(moodLoading)return;
 if(!force&&moodData&&Date.now()-moodLoadedAt<MOOD_REFRESH_MS)return;
 moodLoading=true;
 try{moodData=await api('/api/market-mood');}
 catch(e){moodData={status:'unavailable',message:e.message||'市场情绪数据未取得。'};}
 finally{moodLoading=false;moodLoadedAt=Date.now();}
 renderMoodCard();renderMoodView();
}
function renderMoodCard(){
 const slot=$('mood-pool-slot');if(!slot)return;
 if(!moodData){slot.innerHTML='<div class="mood-pool-card muted"><div><strong>市场情绪 · 市场先生状态</strong><p class="small">正在读取交易所与指数公司的公开数据…</p></div></div>';return;}
 slot.innerHTML=window.MarketMood?.renderPoolCard(moodData)||'';
 window.MarketMood?.paintBandStrip(moodData);
}
function renderMoodView(){
 const box=$('mood-content');if(!box)return;
 if(!moodData){box.className='empty';box.textContent='正在读取市场情绪数据…';return;}
 box.className='';
 box.innerHTML=window.MarketMood?.render(moodData)||'';
 window.MarketMood?.paintBandStrip(moodData);
 if(currentView==='mood')window.MarketMood?.renderCharts(moodData);
}
// 批量测算取数：服务端按政策实时算，这里最多五分钟取一次，免得来回切页反复拉。
async function loadScenarios(force){
 if(scenariosLoading)return;
 if(!force&&scenariosData&&Date.now()-scenariosLoadedAt<SCENARIOS_REFRESH_MS)return;
 scenariosLoading=true;
 const box=$('scenarios-content');
 try{scenariosData=await api('/api/valuation-scenarios');}
 catch(e){scenariosData={rows:[],skipped:[],error:e.message||'测算数据未取得。'};}
 finally{scenariosLoading=false;scenariosLoadedAt=Date.now();}
 renderScenarios();
}
function renderScenarios(){
 const box=$('scenarios-content');if(!box)return;
 if(!scenariosData){box.className='empty';box.textContent='正在读取测算结果…';return;}
 box.className='';
 if(scenariosData.error){box.innerHTML='<div class="empty">测算结果取不到：'+esc(scenariosData.error)+'</div>';return;}
 box.innerHTML=window.ValuationScenarios?window.ValuationScenarios.render(scenariosData):'<p class="muted">测算模块未加载。</p>';
}
async function load(){
 state=await api('/api/state');
 if(!state.ai||!state.quality_counts||!state.quality_policy||!Array.isArray(state.quality_rules)){
  $('feedback').innerHTML='当前是旧版本地服务，页面与数据接口版本不一致。请打开 <a href="http://127.0.0.1:18766/">服务器私有版（127.0.0.1:18766）</a>。';
  for(const id of ['refresh-market','scan-quality','rescan-quality','pause-quality','open-company'])$(id).disabled=true;
  return;
 }
 renderState();if(state.job.state==='running'&&!polling){polling=true;poll();}
}
async function poll(){await new Promise(r=>setTimeout(r,2500));try{await load();if(state.job.state==='running'){poll();}else{polling=false;if(selected)await openCompany(selected,false);}}catch(e){polling=false;feedback(e.message);}}
function renderState(){
 $('date').textContent=state.date; $('storage-mode').textContent=window.StaticSite?.enabled?'静态快照 · 只读':(state.deployment==='private-server'?'腾讯云私有保存':'本地保存'); $('ai-status').textContent=`${state.ai.model} ${state.ai.configured?'已配置':'未配置'} · 关注 ${state.ai.watchlist.codes.length}/10 家 · 每天中国时间 ${state.ai.watchlist.time} 更新关注公司的公开资讯与研读`; const qc=state.quality_counts; $('quality-summary').textContent=`严格通过 ${qc.passed} 家 · 未通过 ${qc.excluded} 家 · 数据待补 ${qc.pending} 家 · 未扫描 ${qc.unscanned} 家 · 金融单独研究 ${qc.separate} 家`; const qs=state.quality_snapshot||{}; $('quality-record').textContent=qs.latest_as_of?`已保存筛选记录：${qs.oldest_as_of===qs.latest_as_of?qs.latest_as_of:qs.oldest_as_of+' 至 '+qs.latest_as_of}。打开网页不会重筛；继续筛选只处理未完成的公司。新财报公布后可主动重新筛选。`:'暂无已保存的财务筛选记录。'; $('quality-rules').innerHTML='<ol>'+state.quality_rules.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol>'; $('scan-quality').disabled=state.job.state==='running'||qc.unscanned===0; $('scan-quality').textContent=qs.latest_as_of?'继续筛选未完成':'开始财务筛选'; const canResume=state.quality_progress?.mode==='rescan'&&['paused','failed'].includes(state.quality_progress.state); $('rescan-quality').textContent=canResume?'继续重新筛选':'重新筛选全部'; $('rescan-quality').disabled=state.job.state==='running'||state.counts.eligible===0; $('pause-quality').disabled=!(state.job.state==='running'&&['quality_scan','quality_rescan','quality_rescan_resume'].includes(state.job.kind));$('notice').textContent=state.risk_notice;
 $('stats').innerHTML=[['上市股票',state.counts.total,'主表全市场记录'],['严格财务通过',state.quality_counts.passed,'基础池 '+state.counts.eligible+' 家'],['审核有效',state.counts.approved,'十年 ROE 与定性审核'],['全部核查就绪',state.counts.candidates,'价格候选 '+(state.counts.price_candidates||0)+' 家']].map(x=>`<div class="stat"><span class="muted">${x[0]}</span><strong>${num(x[1],0)}</strong><span class="small">${x[2]}</span></div>`).join('');
 $('candidate-criteria').textContent=`严格财务通过 + 定性审核有效 + 安全边际至少 ${state.quality_policy.margin_min}% + 清单逐项人工核查；完成仍需自行决定是否投资。`;renderQualitySettings();
 $('management-count').textContent=`管理层 ${state.management_ready||0} / ${state.quality_counts.passed} · 历年事件 ${state.history_ready||0} / ${state.quality_counts.passed} · 掌舵人资讯 ${state.people_news_ready||0} / ${state.quality_counts.passed} · 全历史财务 ${state.financial_archive_ready||0} / ${state.quality_counts.passed} · 行业档案 ${state.industry_ready||0} / ${state.quality_counts.passed}`;
 for(const id of ['update-management-pool','update-company-history-pool','update-people-news-pool','update-financial-archive-pool','update-financial-filings-pool','update-industry-research-pool'])$(id).disabled=state.job.state==='running'||state.quality_counts.passed===0;
 $('job').textContent=state.job.message;$('job').className='job '+state.job.state;$('refresh-market').disabled=state.job.state==='running';$('updated').textContent=state.market_fetched_at?'主表更新：'+state.market_fetched_at+' · 来源：'+(state.market_source||'待核'):'尚未连接股票数据';renderPool();renderCandidates();
}
function renderQualitySettings(){
 const box=$('quality-settings'),p=state.quality_policy,signature=JSON.stringify(p);
 if(box.dataset.signature!==signature){
  const fields=[['roe_mean_min','十年 ROE 均值下限','%',0,100,0.1],['roe_std_max','十年 ROE 标准差上限','百分点',0,50,0.1],['roe_year_min','十年最低 ROE 下限','%',-100,100,0.1],['roe_latest_min','最近完整年 ROE 下限','%',-100,100,0.1],['deducted_positive_years_min','扣非净利润为正的最少年数','年',0,10,1],['cash_positive_years_min','经营现金流/收入为正的最少年数','年',0,10,1],['roic_mean_min','近五年 ROIC 均值下限','%',0,100,0.1],['debt_ratio_max','资产负债率上限','%',0,100,0.1],['net_debt_ebitda_max','净负债/EBITDA 上限','倍',0,20,0.1],['margin_min','最终候选安全边际下限','%',0,90,0.1]];
  box.innerHTML=`<form id="quality-policy-form"><h3>自定义数值门槛</h3><div class="policy-grid">${fields.map(([key,label,unit,min,max,step])=>`<label class="field">${label}（${unit}）<input type="number" name="${key}" min="${min}" max="${max}" step="${step}" value="${esc(p[key])}" required></label>`).join('')}</div><label class="checkline"><input type="checkbox" name="allow_net_cash_exception" ${p.allow_net_cash_exception?'checked':''}>资产负债率超出上限时，允许净现金公司通过该项</label><div class="policy-actions"><button type="submit" class="primary">保存并重新计算</button><button type="button" id="reset-quality-policy">填入默认值</button><span class="small muted">调整仅改变规则，不修改原始财报、人工审核或 DCF 假设。</span></div></form>`;
  box.dataset.signature=signature;
 }
 const busy=state.job.state==='running'&&!['quality_scan','quality_rescan','quality_rescan_resume'].includes(state.job.kind);
 for(const control of box.querySelectorAll('input,button'))control.disabled=busy;
}
// 分红与借款派息核查：逐年列出分红、每股经营现金流、有息负债净增与判定，让人自己复核。
// 档案里的资本结构与融资数据一并列出：光看「分红没被经营现金流覆盖」说不清钱从哪来。
function dividendPanel(d,archive){
 if(!d)return '';
 if(d.state==='skipped')return `<div class="panel"><h3>分红与借款派息核查</h3><p class="small muted">${esc(d.note||'本次筛选没有核查派息。')}</p></div>`;
 const rows=(d.per_year||[]).filter(item=>(item.dividend_per_share||0)>0||item.ocf_per_share!=null);
 const flag=d.state==='borrowing'?'<span class="pill gray">借钱派息 · 不通过</span>':'<span class="pill">未发现借款派息</span>';
 // 档案逐年数据：资产负债率、筹资净额、分配股利及付息、取得借款收到的现金。
 const archiveByYear=new Map((archive?.annual||[]).map(row=>[Number(row.year),row]));
 const archiveCell=(row,path)=>{let node=archiveByYear.get(Number(row.year));for(const key of path){if(node==null)return null;node=node[key];}return node==null?null:node;};
 const moneyCell=(row,path)=>{const value=archiveCell(row,path);return value==null?'—':yi(value)+' 亿';};
 const ratioCell=row=>{const value=archiveCell(row,['derived','liabilities_to_assets_pct']);return value==null?'—':num(value)+'%';};
 const hasArchive=archiveByYear.size>0;
 return `<div class="panel"><h3>分红与借款派息核查 ${flag}</h3><p class="small muted">近十年有现金分红 <strong>${esc(d.paying_year_count)}</strong> 年，最长连续 <strong>${esc(d.consecutive_years)}</strong> 年，最近一次 ${esc(d.last_dividend_year||'—')} 年。${esc(d.note||'')}</p><p class="small muted">判定口径：当年<strong>已实施</strong>的现金分红 &gt; 当年经营活动现金流量净额（用每股口径比较），<strong>且</strong>当年有息负债净增加 &gt; 0 —— 缺口由新增负债补上，才算借钱派息。分红超过经营现金流但没有增负债的照实列出，但不判为借钱派息。</p><div class="scroll"><table><thead><tr><th>年度</th><th>每股分红</th><th>每股经营现金流</th><th>分红缺口</th><th>有息负债净增</th><th>判定</th>${hasArchive?'<th>资产负债率</th><th>筹资净额</th><th>分配股利及付息</th><th>取得借款收到的现金</th>':''}</tr></thead><tbody>${rows.map(item=>`<tr${item.borrowing_to_pay_dividend?' class="row-flag"':''}><td>${esc(item.year)}</td><td>${(item.dividend_per_share||0)>0?num(item.dividend_per_share,4)+' 元':'—'}</td><td>${item.ocf_per_share==null?'—':num(item.ocf_per_share,4)+' 元'}</td><td>${item.cash_gap==null?'—':num(item.cash_gap,4)+' 元'}</td><td>${item.interest_debt_change==null?'—':yi(item.interest_debt_change)+' 亿'}</td><td>${item.borrowing_to_pay_dividend?'<span class="pill gray">借钱派息</span>':((item.dividend_per_share||0)>0&&item.covered_by_operating_cash===false?'<span title="当年分红超过经营活动现金流量净额，但当年有息负债没有净增加，缺口不是新增负债补的，不判为借钱派息">未覆盖 · 未增负债</span>':'<span title="当年分红被经营活动现金流量净额覆盖">现金流覆盖</span>')}</td>${hasArchive?`<td>${ratioCell(item)}</td><td>${moneyCell(item,['cash_flow','n_cash_flows_fnc_act'])}</td><td>${moneyCell(item,['cash_flow','c_pay_dist_dpcp_int_exp'])}</td><td>${moneyCell(item,['cash_flow','c_recp_borrow'])}</td>`:''}</tr>`).join('')}</tbody></table></div><p class="small muted">分红方案只认「已实施」；预案和股东大会通过不算钱已经掏出去。分红用每股税前金额，按除权除息日归年；经营现金流取 Tushare 每股经营现金流 ocfps，与分红同为每股口径，股本变动不会让两边对不上。</p>${hasArchive?'<p class="small muted">右侧四列来自公司财务档案（上市以来逐年）：资产负债率＝总负债÷总资产；筹资净额、分配股利及付息、取得借款收到的现金均取自当年现金流量表。「分配股利及付息」是合计口径，含利息与少数股东利润分配；它与上面按除权除息日归年的分红不是同一年的口径，两列不能直接相减。</p>':''}</div>`;
}
function statusCell(row){if(row.screen.state==='excluded')return '<span class="pill gray">已排除</span>';if(row.screen.state==='pending')return '<span class="pill warning">数据待补</span>';if(row.quality_free_preview)return '<span class="pill warning">旧筛选记录 · 免费数据待核</span>';if(row.quality?.state==='passed')return '<span class="pill">财务预筛通过 · 待定性</span>';if(row.quality?.state==='excluded')return '<span class="pill gray">财务预筛未通过</span>';if(row.quality?.state==='separate')return '<span class="pill gray">金融单独研究</span>';if(row.review_current)return '<span class="pill">审核有效</span>';return '<span class="pill warning">待审核与风险核验</span>';}
const POOL_SORT_COLUMNS=[['symbol','公司'],['industry','行业'],['list_date','上市日期'],['roe','十年 ROE 均值'],['cyclicality','周期属性'],['dividend','分红与借款'],['quality_date','筛选日期'],['status','状态']];
const POOL_FIRST_DIR={roe:-1,cyclicality:-1};
const poolCollator=new Intl.Collator('zh-Hans-CN',{numeric:true,sensitivity:'base'});
function poolSortLabel(key){const found=POOL_SORT_COLUMNS.find(column=>column[0]===key);return found?found[1]:key;}
function poolSortHead(){return POOL_SORT_COLUMNS.map(([key,label])=>{if(!key)return `<th>${label}</th>`;const active=poolSortKey===key;const arrow=active?(poolSortDir>0?'▲':'▼'):'↕';return `<th><button type="button" class="pool-sort${active?' active':''}" data-pool-sort="${key}" aria-label="按${label}排序">${label}<span class="sort-arrow" aria-hidden="true">${arrow}</span></button></th>`;}).join('')+'<th></th>';}
// 分红与借款：只显示真正核查过的公司；没核查的不留空白误导，写明原因。
function dividendCell(row){
 const d=row.quality?.dividend;
 if(!d||d.state==='skipped')return '<span class="muted" title="'+(d?.note||'未核查')+'">—</span>';
 if(d.state==='no_data')return '<span class="muted" title="未取到已实施的分红方案">分红数据待补</span>';
 if(d.state==='borrowing'){
  const years=(d.borrowing_years||[]).map(item=>item.year).join('、');
  return `<span class="pill gray" title="${esc(d.note||'')}">借钱派息 ${esc(years)} 年</span>`;
 }
 return `<span title="近十年有现金分红 ${esc(d.paying_year_count)} 年；最长连续 ${esc(d.consecutive_years)} 年；最近一次 ${esc(d.last_dividend_year||'—')} 年">派息 ${esc(d.paying_year_count)}/10 年 · 连续 ${esc(d.consecutive_years)} 年</span>`;
}
function poolStatusRank(row){
 if(row.screen.state==='excluded')return 7;
 if(row.screen.state==='pending')return 6;
 if(row.quality_free_preview)return 2;
 if(row.quality?.state==='passed')return 1;
 if(row.quality?.state==='excluded')return 4;
 if(row.quality?.state==='separate')return 5;
 if(row.review_current)return 0;
 return 3;
}
function poolSortValue(row,key){
 if(key==='symbol')return row.name||row.symbol;
 if(key==='industry')return row.industry||null;
 if(key==='list_date')return Number(row.list_date)||null;
 if(key==='roe'){const value=row.roe?.mean??row.quality?.metrics?.roe_mean;return value==null||!Number.isFinite(Number(value))?null:Number(value);}
 if(key==='cyclicality'){const value=row.cyclicality?.amplitude_ratio;return value==null||!Number.isFinite(Number(value))?null:Number(value);}
 // 分红与借款：借钱派息的排最前，其次按有分红年数从多到少；没核查过或数据待补的排最后。
 if(key==='dividend'){const d=row.quality?.dividend;if(!d||d.state==='skipped')return null;const rank=d.state==='borrowing'?0:(d.state==='no_data'?2:1);return rank*1000-(Number(d.paying_year_count)||0);}
 if(key==='quality_date')return row.quality?.as_of||null;
 if(key==='status')return poolStatusRank(row);
 return null;
}
function comparePoolRows(a,b,key,dir){
 const left=poolSortValue(a,key),right=poolSortValue(b,key);
 if(left==null&&right==null)return 0;
 if(left==null)return 1;
 if(right==null)return -1;
 if(typeof left==='number'&&typeof right==='number')return (left-right)*dir;
 return poolCollator.compare(String(left),String(right))*dir;
}
function sortPoolRows(rows,key=poolSortKey,dir=poolSortDir){
 if(!key)return rows;
 return [...rows].sort((a,b)=>comparePoolRows(a,b,key,dir));
}
function togglePoolSort(key){
 if(poolSortKey===key)poolSortDir=poolSortDir>0?-1:1;
 else{poolSortKey=key;poolSortDir=POOL_FIRST_DIR[key]??1;}
 renderPool();
}
function renderPool(){
 const query=$('search').value.trim().toLowerCase(),filter=$('filter').value;
 const rows=state.rows.filter(r=>{const match=filter==='all'||r.screen.state===filter||(r.screen.state==='eligible'&&((filter==='quality_passed'&&r.quality?.state==='passed')||(filter==='quality_pending'&&['pending','unscanned'].includes(r.quality?.state))||(filter==='quality_excluded'&&r.quality?.state==='excluded')||(filter==='quality_separate'&&r.quality?.state==='separate')));return match&&(!query||(r.symbol+r.name).toLowerCase().includes(query));});
 const sorted=sortPoolRows(rows);
 $('pool-table').innerHTML=sorted.length?`<table><thead><tr>${poolSortHead()}</tr></thead><tbody>${sorted.map(r=>`<tr><td><strong>${esc(r.name)}</strong><br><span class="code">${esc(r.symbol)}</span></td><td>${esc(r.industry||'—')}</td><td>${esc(cnDate(r.list_date))}</td><td>${r.roe?num(r.roe.mean)+'%'+(r.roe.complete?'':'（不完整）'):r.quality?.metrics?.roe_mean!=null?num(r.quality.metrics.roe_mean)+'%':'尚未拉取'}</td><td>${window.Cyclicality?.poolCell(r.cyclicality)||'<span class="muted">待补</span>'}</td><td>${dividendCell(r)}</td><td>${esc(r.quality?.as_of||'—')}</td><td title="${esc([...(r.quality?.reasons||[]),...(r.quality?.missing||[]),...r.screen.reasons].join('；'))}">${statusCell(r)}</td><td><button data-company="${esc(r.symbol)}">查看公司</button></td></tr>`).join('')}</tbody></table><div class="small muted">共 ${sorted.length} 家${poolSortKey?`，已按「${poolSortLabel(poolSortKey)}」${poolSortDir>0?'升序':'降序'}`:''}；点击表头可切换排序，缺数据的排在最后；表内可按列筛选</div>`:'<div class="empty">当前筛选下没有匹配公司。未扫描和缺数据不会被误认为通过。</div>';
 // 页内事件统一委托，所有来源文本转义后渲染。
}
function renderCandidates(){const rows=state.price_candidates||[];$('candidate-table').innerHTML=rows.length?`<p class="small muted">价格条件达标 ${rows.length} 家；其中清单全部人工核实且仍有效 ${state.counts.candidates} 家。清单完成表示可进入最终判断，不是买入指令。</p><div class="scroll"><table><thead><tr><th>公司</th><th>收盘日期</th><th>收盘价</th><th>基准价值 / 股</th><th>安全边际</th><th>逐项清单</th><th>最终核查</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button data-company="${esc(r.symbol)}">${esc(r.name)}</button></td><td>${esc(r.comparison.quote_date)}</td><td>¥${num(r.comparison.price)}</td><td>¥${num(r.valuation.result.per_share)}</td><td>${pct(r.comparison.margin)}</td><td>${esc(r.checklist_summary?.yes||0)}/${esc(r.checklist_summary?.total||0)} 已核 · ${esc(r.checklist_summary?.stale||0)} 待复核</td><td><span class="pill ${r.investment_ready?'':'warning'}">${r.investment_ready?'核查就绪':'尚未完成'}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">目前没有经过定性审核且满足价格条件的公司。<br>数据缺失或未审核的公司不会自动入选。</div>'; }
async function openCompany(code,navigate=true){if(navigate&&!['research','valuation'].includes(currentView))companyOrigin=['pool','scenarios','candidates'].includes(currentView)?currentView:'pool';if(selected!==code){graphMode='recent';historyCategory='all';fcffSelectedYear=null;}selected=code;cycleRecord=null;detail=await api('/api/company/'+encodeURIComponent(code));document.body.dataset.assistantCode=code;document.body.dataset.assistantName=detail.stock?.name||'';$('company-code').value=code;$('company-workspace-name').textContent=detail.stock.name+' · 公司详情';$('company-back').textContent='← 返回'+({pool:'精选标的',scenarios:'批量测算',candidates:'最终候选'}[companyOrigin]);if(navigate)view(companyOrigin==='scenarios'?'valuation':'research');renderCompany();renderValuation();loadCyclicality(code);window.ResearchAssistant?.refreshContext();if(detail.financial_archive){api('/api/risk-free-rate').then(rate=>{if(selected===code){detail.risk_free_rate=rate;window.WaccCalculator?.applyRiskFree(rate);updateWaccFillButtons();}}).catch(()=>{if(selected===code)window.WaccCalculator?.applyRiskFree({status:'unavailable'});});api('/api/cost-of-capital?code='+encodeURIComponent(code)).then(block=>{if(selected===code){detail.cost_of_capital=block;window.WaccCalculator?.applyCostOfCapital(block);updateWaccFillButtons();}}).catch(()=>{});}}
// 周期数据单独取：它要重算 12 年行业序列，混进 /api/company 会把公司页拖慢。
async function loadCyclicality(code){
 if(cycleLoading)return;
 cycleLoading=true;
 try{
  const record=await api('/api/cyclicality/'+encodeURIComponent(code));
  if(selected!==code)return;
  cycleRecord=record;
  const host=$('cyc-panel');
  if(!host)return;
  window.Cyclicality?.disposeCharts();
  host.outerHTML=window.Cyclicality?.panel(record)||'';
  requestAnimationFrame(()=>window.Cyclicality?.renderCharts(record));
 }catch(e){
  if(selected!==code)return;
  cycleRecord={status:'unavailable',message:e.message||'周期数据未取得。'};
  const host=$('cyc-panel');
  if(host)host.outerHTML=window.Cyclicality?.panel(cycleRecord)||'';
 }finally{cycleLoading=false;}
}
function safeLink(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?esc(u.href):'#';}catch{return '#';}}
// 年度顺序开关：最新在前 / 最早在前。历史现金流表与 ROE 年度序列共用一个顺序。
function yearOrderToggle(){return `<button type="button" class="year-order-toggle" data-year-order-toggle aria-label="切换年度排序">年度：${yearOrder==='desc'?'最新在前':'最早在前'} ⇅</button>`;}
function renderCompany(){
 const {stock,company,summary,review,quote,disclosures,quality,ai,watching}=detail;
 const hist=company?.history||[];
 // 按开关排序后的年度序列；表与图共用，避免两处方向相反。
 const rows=yearOrder==='desc'?[...hist].reverse():[...hist];
 const max=Math.max(20,...hist.map(r=>Math.abs(r.roe||0)));
 // 展示层：上市以来全部年度；筛选层：仍是近十年（screener.roe_summary / quality.evaluate）。
 const win=company?.window||null;
 const coverageText=win&&win.first_year?`${win.first_year}–${win.last_year}（${win.years} 年）`:(hist.length?`${hist[0].year}–${hist[hist.length-1].year}（${hist.length} 年）`:'尚未拉取');
 const screeningText=win&&Array.isArray(win.screening_window)?`${win.screening_window[0]}–${win.screening_window[1]}`:'近十年';
 const roeValues=hist.map(r=>Number(r.roe)).filter(v=>Number.isFinite(v));
 roeFullMean=roeValues.length?roeValues.reduce((a,b)=>a+b,0)/roeValues.length:null;
 // 早年被公开财报源补齐的年份要单独说明，不能和 Tushare 实测混成一句。
 const supplement=company?.supplement||null;
 const supplementText=supplement&&supplement.filled?.length?` 其中 ${supplement.filled.length} 个年度由 ${esc(supplement.source)} 补齐（Tushare 无该年报表），表内标「补」；跨来源的年份不算 FCFF。`:'';
 const previousGraph=$('management-graph');if(graphObserver){graphObserver.disconnect();graphObserver=null;}if(previousGraph&&window.echarts)echarts.getInstanceByDom(previousGraph)?.dispose();ValueReport.disposeCharts();window.Cyclicality?.disposeCharts();window.WaccHistory?.disposeCharts();
 $('research-content').className='';
 $('research-content').innerHTML=`<div class="panel company-head"><div><h2>${esc(stock.name)} <span class="code">${esc(selected)}</span></h2><span class="muted">${esc(stock.industry||'')} · 上市 ${esc(cnDate(stock.list_date))}</span></div><div class="actions"><button class="primary" id="fetch-company">拉取上市以来财报与收盘价</button><button id="fetch-disclosures">获取公告入口</button><button id="update-news" class="primary">更新资讯并 AI 研读</button><button id="watch-company">${watching?'取消每日关注':'关注并每日更新'}</button><a class="button" href="api/company/${esc(selected)}" download="${esc(selected)}-研究底稿.json">导出底稿</a></div></div>
 ${ValueReport.renderFinancial(detail)}${ValueReport.renderIndustry(detail)}${window.Cyclicality?.panel(cycleRecord)||''}${window.WaccHistory?.panel(detail.wacc_history)||''}${renderAI(detail)}${renderCompanyHistory(detail)}${renderManagement(detail)}${ValueReport.renderChecklist(detail)}${quality?`<div class="panel"><h3>严格财务预筛 · ${esc(({passed:'通过，仍需定性研究',excluded:'未通过',pending:'数据待补',separate:'单独研究'})[quality.evaluation.state]||quality.evaluation.state)}</h3><p class="small muted">${esc([...(quality.evaluation.reasons||[]),...(quality.evaluation.missing||[])].join('；'))}</p>${(quality.evaluation.reasons||[]).length?'<p class="small muted">未通过原因自带门槛：每条都写明实测值与要求，完整规则见上方筛选规则清单。</p>':''}<div class="scroll"><table><thead><tr><th>检查项</th><th>数值</th><th>要求</th><th>结果</th></tr></thead><tbody>${(quality.evaluation.checks||[]).map(c=>`<tr><td>${esc(c.label)}</td><td>${num(c.value, c.unit==='年'?0:2)}${unitText(c.unit)}</td><td>${esc([c.requirement,c.note].filter(Boolean).join('；')||'—')}</td><td>${c.passed?'通过':'未通过'}</td></tr>`).join('')}</tbody></table></div></div>`:''}${dividendPanel(quality?.evaluation?.dividend,detail.financial_archive)}<div class="grid2"><div class="panel"><div class="section-head"><div><h3>盈利质量 · ROE 年度序列</h3><p class="small muted">柱状图覆盖上市以来全部年度（${coverageText}）；均值与标准差仍是筛选口径的近十年（${screeningText}），不随档案长度改变。</p></div>${yearOrderToggle()}</div>${summary?`<div class="metric-line"><div><span class="small muted">近十年均值 · 筛选口径</span><strong>${num(summary.mean)}%</strong></div><div><span class="small muted">标准差 / 百分点</span><strong>${num(summary.std)}</strong></div><div><span class="small muted">近十年完整度</span><strong>${summary.count}<span class="small muted"> / 10</span></strong></div></div><div class="chart scroll">${rows.map(r=>`<button type="button" class="bar-column" data-roe-bar data-roe-year="${esc(r.year)}" data-roe-value="${r.roe==null?'':esc(r.roe)}" aria-label="查看 ${esc(r.year)} 年 ROE ${r.roe==null?'缺失':num(r.roe,1)+'%'}"><span class="bar-label">${num(r.roe,1)}</span><svg width="32" height="${Math.round(Math.abs(r.roe||0)/max*75)+2}" aria-hidden="true"><rect class="bar ${r.roe<0?'negative':''}" width="32" height="100%" rx="3"/></svg><span class="year">${r.year}</span></button>`).join('')}</div><div id="roe-chart-detail" class="chart-selection" aria-live="polite">点击柱子查看该年的 ROE，并与上市以来全期均值比较。</div><p class="small muted">${summary.passes_mean?'近十年均值达到 15%，波动稳定性仍需判断。':'尚未满足完整十年均值 ≥15% 的要求。'}上市以来全期均值 ${roeFullMean==null?'—':num(roeFullMean)+'%'}（${roeValues.length} 个有 ROE 的年度）。${summary.missing_years.length?' 近十年缺失：'+summary.missing_years.join('、'):''}</p>`:'<p class="muted">尚未拉取财务指标。</p>'}</div><div class="panel"><h3>公开披露与来源</h3><p class="small muted">${esc(disclosures?.coverage||'公告读取暂不等于完成定性审核。请核对年报、风险提示、关联交易和审计意见。')}</p><div class="actions"><a href="https://www.cninfo.com.cn/" target="_blank" rel="noopener">巨潮资讯</a><a href="https://www.sse.com.cn/" target="_blank" rel="noopener">上交所</a><a href="https://www.szse.cn/" target="_blank" rel="noopener">深交所</a></div><div class="disclosures">${(disclosures?.rows||[]).map(r=>`<a class="disclosure" href="${safeLink(r['公告链接'])}" target="_blank" rel="noopener">${esc(r['公告标题'])}<span class="muted">　${esc(r['公告时间'])}</span></a>`).join('')}</div><p class="small muted">${quote?'未复权收盘价 ¥'+num(quote.close)+' · '+esc(quote.trade_date):'尚无收盘价'}<br>${company?'财报抓取：'+esc(company.fetched_at):''}</p>${(company?.errors||[]).map(e=>`<p class="small">${esc(e)}</p>`).join('')}</div></div>
 ${company?`<div class="panel"><div class="section-head"><div><h3>历史现金流 <span class="small muted">金额：亿元；ROE：%</span></h3></div>${yearOrderToggle()}</div><p class="small muted">覆盖 ${coverageText}${win&&win.mode?`（${win.mode}）`:''}；严格财务筛选仍只用近十年 ${screeningText}。首年缺上一年度营运流动资本时，计算 FCFF 留空，不按零算。${supplementText}</p><div class="scroll"><table><thead><tr><th>年度</th><th>ROE</th><th>收入</th><th>经营现金流</th><th>资本开支</th><th>CFO−CapEx 参考</th><th>计算 FCFF</th><th>供应商 FCFF</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.year}${r.supplemented_fields?.length?'<span class="supp-mark" title="该年部分数据由公开财报源补齐">补</span>':''}</td><td>${num(r.roe)}</td><td>${yi(r.revenue)}</td><td>${yi(r.cfo)}</td><td>${yi(r.capex)}</td><td>${yi(r.cfo_less_capex)}</td><td>${yi(r.fcff)}</td><td>${yi(r.vendor_fcff)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">${esc(company.fcff_method)}。历史 FCFF 尚未做一次性项目、资本化政策和周期规范化；DCF 预测需说明依据。CFO−CapEx 仅作现金质量参考。</p><details><summary class="small">查看数据接口和抓取记录</summary><pre>${esc(JSON.stringify(company.sources,null,2))}</pre></details></div>
 <form id="review-form" class="panel"><h3>逐家公司审核 <span class="small muted">${review?'已保存：'+esc(review.saved_at):'尚未审核'}</span></h3><p class="small muted">记录证据与判断。勾选表示你已核对该项；AI 意见需如实标注身份。</p><div class="review-grid">${reviewFields.map(([key,label])=>`<div class="review-item"><label><input type="checkbox" name="${key}_passed" ${review?.[key]?.passed?'checked':''}>${label}</label><textarea name="${key}_reason" placeholder="具体依据，至少 8 个字">${esc(review?.[key]?.reason||'')}</textarea></div>`).join('')}</div><div class="form-row"><label class="field">审核者<input name="reviewer" value="${esc(review?.reviewer||'')}" required></label><label class="field">审核身份<select name="reviewer_type"><option value="human" ${review?.reviewer_type==='human'?'selected':''}>本人审核</option><option value="ai" ${review?.reviewer_type==='ai'?'selected':''}>AI 研究意见</option></select></label></div><label class="field">证据链接，每行一条<textarea name="sources" placeholder="年报、公告或其他原始证据的链接">${esc((review?.sources||[]).join('\n'))}</textarea></label><div class="form-row"><label class="field">风险公告核验日期<input name="risk_checked_date" type="date" value="${esc(review?.risk_checked_date||'')}"></label><label class="field">审核结论<select name="decision"><option value="pending" ${review?.decision==='pending'?'selected':''}>待补证</option><option value="approved" ${review?.decision==='approved'?'selected':''}>明确保留，进入估值</option><option value="rejected" ${review?.decision==='rejected'?'selected':''}>排除</option></select></label></div><button class="primary" type="submit">保存审核结论</button></form>`:''}`;
 if(quality?.free_source_preview){const preview=quality.free_source_preview;$('research-content').insertAdjacentHTML('afterbegin',`<div class="panel notice"><strong>免费数据待核</strong><p class="small">${esc(preview.note)} 旧筛选记录日期：${esc(quality.evaluation?.as_of||'未知')}；免费数据检查：${esc(preview.checked_at||'未知')}。缺项：${esc((preview.evaluation?.missing||[]).join('；')||'无')}。</p></div>`);}
 renderManagementGraph(detail.management_graph);
 ValueReport.renderCharts(detail);
 updateWaccFillButtons();
 requestAnimationFrame(()=>window.WaccHistory?.renderCharts(detail.wacc_history));
}

function renderManagement(d){
 const m=d.management;if(!m)return '<div class="panel"><div class="section-head"><h3>管理层与任职关系</h3><button id="fetch-management">获取这家公司的管理层</button></div><p class="small muted">取得披露姓名、职务、任期与简历后，在这里展示人物档案和关系图。履历与新闻不能单独证明个人品行。</p></div>';
 const info=m.company_info||{};
 const summary=`法定代表人：${esc(info.legal_representative||'待核')} · 总经理：${esc(info.general_manager||'待核')} · 董秘：${esc(info.board_secretary||'待核')}`;
 const cards=m.people.map(person=>{const roles=person.roles||[],latest=roles[0]||{};return `<details class="manager-card" id="manager-${esc(person.id)}"><summary><strong>${esc(person.name)}</strong><span>${esc(latest.title||'职务待核')} · 最近披露 ${esc(person.last_disclosed||'—')}</span></summary><p class="small muted">出生资料：${esc(person.birthday||'未提供')} · 学历：${esc(person.education||'未提供')} · ${person.has_open_term?'至少一条任职记录未列离任日；请核对最新公告':'已列离任日期；可能是历史任职'}</p><div class="manager-roles">${roles.map(role=>`<div><strong>${esc(role.company_name)} · ${esc(role.title)}</strong><span class="small muted">任期 ${esc(role.begin_date||'未提供')} — ${esc(role.end_date||'未列离任日')} · 披露 ${esc(role.ann_date||'未提供')}</span></div>`).join('')}</div><h4>披露简历</h4><p class="manager-resume">${esc(person.resume||'来源未提供简历，不能推断其他任职。')}</p></details>`}).join('');
 return `<div class="panel management-panel"><div class="section-head"><div><h3>管理层与任职关系</h3><p class="small muted">${esc(m.record_count)} 条任职记录 · ${esc(m.people.length)} 位人员 · 抓取 ${esc(m.fetched_at)}</p></div><div class="actions"><button id="fetch-management">更新管理层资料</button><button id="update-people-news" class="primary">更新掌舵人新闻线索</button></div></div><p>${summary}</p><p class="small muted">数据源：<a href="${safeLink(m.source.url)}" target="_blank" rel="noopener">Tushare 上市公司管理层接口</a>。图中仅画已获取公司的披露任职；跨公司同名者即使出生年和性别匹配仍须核对身份，虚线仅供排查。未列离任日不等于确认仍在任。</p><div class="graph-controls"><button data-graph-mode="recent" class="${graphMode==='recent'?'active':''}">近期任职</button><button data-graph-mode="all" class="${graphMode==='all'?'active':''}">全部历史任职</button><span id="graph-scope" class="small muted"></span></div><div id="management-graph" class="management-graph" role="img" aria-label="管理层与公司任职关系图"></div><div id="management-graph-detail" class="chart-selection" aria-live="polite">点击人物、公司或任职线，查看该节点或披露关系。</div><p class="small muted">拖动、滚轮缩放；点击人物查看履历。虚线为历史岗位或待核跨公司线索。其他公司的职务可能仅见于简历，未核实前不绘制关系线。</p>${renderPeopleNews(d.people_news)}<div class="manager-list">${cards}</div></div>`;
}

function renderPeopleNews(bundle){
 if(!bundle)return '<p class="small muted">尚未更新掌舵人新闻。获取后展示履历、正负面搜索线索和 MiniMax 待核草稿。</p>';
 const labels={career:'任职线索',positive_lead:'正面线索',risk_lead:'负面线索',uncertain:'待核线索'},sources=new Map((bundle.evidence||[]).map(x=>[x.id,x]));
 const observations=(bundle.report?.observations||[]).map(item=>`<div class="observation"><span class="pill ${item.kind==='risk_lead'?'warning':''}">${esc(labels[item.kind]||'待核')}</span><p>${esc(item.claim)}</p>${item.evidence_ids.map(id=>{const row=sources.get(id);return row?`<a href="${safeLink(row.url)}" target="_blank" rel="noopener">${esc(row.title)}</a> <span class="small muted">${esc(row.published_at)} · ${esc(row.scope)}</span>`:''}).join('<br>')}</div>`).join('');
 return `<div class="people-news"><h4>掌舵人正负面资料 <span class="pill warning">${esc(bundle.model)} 草稿 · 待复核</span></h4><p>${esc(bundle.report?.overview||'暂无概述')}</p><p class="small muted">${esc(bundle.scope)} · 更新 ${esc(bundle.created_at)}。不对个人品行自动打分。</p>${observations||'<p class="small muted">没有足够证据形成观察；请查看搜索入口。</p>'}${(bundle.coverage||[]).filter(x=>x.state==='failed').map(x=>`<p class="small muted">${esc(x.name)} 的联网搜索失败：${esc(x.message)}</p>`).join('')}<details><summary>查看全部 ${bundle.evidence.length} 条线索</summary><div class="disclosures">${bundle.evidence.map(row=>`<a class="disclosure" href="${safeLink(row.url)}" target="_blank" rel="noopener">${esc(row.person_name)} · ${esc(row.title)} · ${esc(row.published_at)}</a>`).join('')}</div></details></div>`;
}

function renderCompanyHistory(d){
 const bundle=d.company_history;
 if(!bundle)return '<div id="company-history-panel" class="panel"><div class="section-head"><div><h3>公司历年事件</h3><p class="small muted">诉讼、监管、表彰与经营新闻的按年检索记录。</p></div><button id="update-company-history">检索近十年</button></div><p class="small muted">尚无历史事件记录。搜索结果仅是线索，须打开原文核实。</p></div>';
 const labels={legal_lead:'诉讼/仲裁线索',risk_lead:'监管/负面线索',praise_lead:'表彰/正面线索',other:'其他新闻'},allRows=bundle.evidence||[],rows=historyCategory==='all'?allRows:allRows.filter(row=>row.category===historyCategory);
 const years=[...new Set(rows.map(x=>x.year||'日期不明'))].sort((a,b)=>String(b).localeCompare(String(a)));
 const timeline=years.map(year=>`<div class="history-year"><h4>${esc(year)} <span class="small muted">文章 ${rows.filter(x=>(x.year||'日期不明')===year).length} 条</span></h4>${rows.filter(x=>(x.year||'日期不明')===year).map(row=>`<div class="history-item"><span class="pill ${['legal_lead','risk_lead'].includes(row.category)?'warning':''}">${esc(labels[row.category])}</span><a href="${safeLink(row.url)}" target="_blank" rel="noopener">${esc(row.title)}</a><span class="small muted">${esc(row.published_at)}</span><p class="small muted">${esc(row.snippet)}</p></div>`).join('')}</div>`).join('');
 return `<div id="company-history-panel" class="panel"><div class="section-head"><div><h3>公司历年事件</h3><p class="small muted">${allRows.length} 条线索 · ${esc(bundle.fetched_at)}</p></div><button id="update-company-history">重新检索近十年</button></div><p class="small muted">${esc(bundle.scope)}。按文章发表年份整理，未必是事件发生年；涉诉不代表公司败诉甚至作为当事方，须核对原文、案号、涉案金额及进展。</p><div class="history-filters"><label>查看类别 <select id="history-category-filter">${[['all','全部'],...Object.entries(labels)].map(([key,label])=>`<option value="${key}" ${historyCategory===key?'selected':''}>${esc(label)} · ${key==='all'?allRows.length:allRows.filter(row=>row.category===key).length}</option>`).join('')}</select></label><span class="small muted">筛出 ${rows.length} 条文章线索</span></div><details open><summary>年度文章时间线</summary><div class="company-timeline">${timeline||'<p class="small muted">这一类别暂无检索结果；不能据此判断没有相关事件。</p>'}</div></details></div>`;
}

function highlightManagerCard(personId){
 for(const card of document.querySelectorAll('.manager-card.active'))card.classList.remove('active');
 if(!personId)return;
 const card=document.getElementById('manager-'+personId);
 if(!card)return;
 void card.offsetWidth;
 card.classList.add('active');
 card.scrollIntoView({behavior:'smooth',block:'center'});
}

function renderManagementGraph(graph){
 const target=$('management-graph');if(!target||!graph)return;
 if(!window.echarts){target.textContent='关系图组件未加载；下方履历仍可阅读。';return;}
 if(graphObserver){graphObserver.disconnect();graphObserver=null;}echarts.getInstanceByDom(target)?.dispose();
 const people=detail.management?.people||[],info=detail.management?.company_info||{};
 const recent=people.filter(p=>p.has_open_term&&Number(String(p.last_disclosed||'').slice(0,4))>=Number(state.date.slice(0,4))-3);
 const keyNames=new Set([info.legal_representative,info.general_manager,info.board_secretary].filter(Boolean));
 const keyPeople=[...people.filter(p=>keyNames.has(p.name)),...people.filter(p=>p.roles?.slice(0,3).some(r=>/董事长|总经理/.test(r.title||''))).slice(0,3)];
 const selectedPeople=[...new Map([...keyPeople,...recent].map(p=>[p.id,p])).values()];
 const keep=new Set(selectedPeople.map(p=>'person:'+p.id));
 const links=graphMode==='all'?graph.links:graph.links.filter(link=>keep.has(link.source));
 const nodeIds=new Set(links.flatMap(link=>[link.source,link.target]));nodeIds.add('company:'+selected);
 const nodes=graphMode==='all'?graph.nodes:graph.nodes.filter(node=>nodeIds.has(node.id));
 $('graph-scope').textContent=graphMode==='all'?`显示 ${nodes.length} 个节点；历史记录不等于现任`:`显示重点负责人及近期披露的 ${selectedPeople.length} 人；仍须核对现任名单`;
 const chart=echarts.init(target);chart.setOption({tooltip:{formatter:arg=>{const d=arg.data||{};return esc(d.name||d.value||'')+(d.ann_date?'<br>披露 '+esc(d.ann_date):'');}},legend:[{data:graph.categories.map(c=>c.name),bottom:0}],series:[{type:'graph',layout:'force',data:nodes,links,categories:graph.categories,roam:true,label:{show:true,position:'right',formatter:'{b}'},labelLayout:{hideOverlap:true},scaleLimit:{min:.4,max:2},lineStyle:{color:'source',curveness:.2,opacity:.6},force:{repulsion:150,edgeLength:[90,180],gravity:.08},emphasis:{focus:'adjacency'}}]});
 chart.on('click',arg=>{const d=arg.data||{},panel=$('management-graph-detail');if(!panel)return;if(arg.dataType==='edge'){
  const personNode=graph.nodes.find(node=>node.id===d.source),companyNode=graph.nodes.find(node=>node.id===d.target);
  panel.innerHTML=`<strong>${esc(personNode?.name||'人员')} → ${esc(companyNode?.name||'公司')}</strong><span>披露职务：${esc(d.value||'未提供')}；披露日期：${esc(d.ann_date||'未提供')}；离任日期：${esc(d.end_date||'未列')}。虚线或未列离任日均须核对原始公告，不能直接确认现任或跨公司同一人。</span>`;
  highlightManagerCard(String(d.source||'').startsWith('person:')?String(d.source).slice(7):null);
 }else if(d.person_id){const person=people.find(item=>item.id===d.person_id);panel.innerHTML=`<strong>${esc(d.name||person?.name||'人员')}</strong><span>${esc(person?.roles?.[0]?.title||'职务待核')} · 最近披露 ${esc(person?.last_disclosed||'日期待核')}。下方已高亮对应履历卡片，可展开查看全部已取得任职。</span>`;highlightManagerCard(d.person_id);
 }else{panel.innerHTML=`<strong>${esc(d.name||'公司')} ${esc(d.code||'')}</strong><span>${d.category===2?'跨公司同名任职待核节点，姓名与出生资料匹配仍不能证明是同一人。':'当前研究公司的管理层关系中心；点击连线可看披露职务。'}</span>`;highlightManagerCard(null);}});
 graphObserver=new ResizeObserver(()=>{if(target.isConnected)chart.resize();});graphObserver.observe(target);
}

function renderAI(d){
 const ai=d.ai;
 if(!ai)return '<div class="panel"><h3>MiniMax 资讯研读</h3><p class="muted">点击“更新资讯并 AI 研读”，收集公告标题、新闻摘要和联网搜索结果，再生成带证据的研究草稿。</p><p class="small muted">关注后每天中国时间 18:30 自动更新；当前不会自动确认审核结论或更改估值。</p></div>';
 const report=ai.report,sourceMap=new Map(ai.evidence.map(x=>[x.id,x]));
 const labels={business:'商业模式',moat:'护城河',operations:'经营变化',management:'管理层',related_party:'关联交易',risk:'风险'};
 const kinds={reported:'公开报道',interpretation:'模型推断',uncertain:'未核实'};
 return `<div class="panel ai-panel"><div class="section-head"><h3>MiniMax 资讯研读 <span class="pill warning">AI 草稿 · 待复核</span></h3><span class="small muted">${esc(ai.model)} · ${esc(ai.created_at)}</span></div><p>${esc(report.summary)}</p><p class="small muted">${esc(ai.scope)}。完整年报与公告正文尚需阅读；搜索结果的抓取日期不等于事件发生日期。</p><h3>新信息与变化</h3><ul>${report.change_summary.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${report.observations.map(o=>`<div class="observation"><strong>${esc(labels[o.topic])}</strong> <span class="pill ${o.kind==='reported'?'':'warning'}">${esc(kinds[o.kind])}</span><p>${esc(o.claim)}</p><div class="small">${o.evidence_ids.map(id=>{const e=sourceMap.get(id);return e?`<a href="${safeLink(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a> <span class="muted">${esc(e.published_at)} · ${esc(e.scope)}</span>`:''}).join('<br>')}</div></div>`).join('')}<h3>仍需补证</h3><ul>${report.missing_information.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${ai.source_errors.map(x=>`<p class="small muted">来源缺口：${esc(x)}</p>`).join('')}<details><summary>查看全部证据入口（${ai.evidence.length} 条）</summary><div class="disclosures">${ai.evidence.map(e=>`<a class="disclosure" href="${safeLink(e.url)}" target="_blank" rel="noopener">${esc(e.title)} · ${esc(e.published_at)} · ${esc(e.scope)}</a>`).join('')}</div></details></div>`;
}

// 统一的 DCF 折现率入口：新情景自动带入，已有情景与人工修改保留。
// 当前口径来自公司页「WACC 分步计算」，而那套参数是异步取回来的
// （β 回归、股权溢价、无风险利率、债务成本），
// 所以按钮状态必须跟着计算器实时更新，不能在渲染那一刻定死。
function updateWaccFillButtons(){
 const calc=window.WaccCalculator?.current?.()||null;
 const dcf=document.querySelector('#dcf-use-current-wacc');
 if(dcf){dcf.textContent=calc?`填入当前口径 WACC（${num(calc.wacc_pct)}%）`:'填入当前口径 WACC';dcf.disabled=!calc;}
 const input=$('dcf-form')?.querySelector('[name="wacc"]');
 if(calc&&input&&(input.value===''||input.dataset.waccAuto==='true')){
  input.value=Number(calc.wacc_pct).toFixed(4);input.dataset.waccAuto='true';
 }

}
function renderValuation(){
 const {stock,company,quote,valuation}=detail;
 const dcf_draft=companyOrigin==='scenarios'?(detail.dcf_drafts?.[companyScenarioBasis]||detail.dcf_draft):detail.dcf_draft;
 $('valuation-content').className='';
 const inp=valuation?.inputs||dcf_draft?.inputs||{};
 const history=(company?.history||[]).filter(r=>Number.isInteger(Number(r.year))).sort((a,b)=>Number(a.year)-Number(b.year));
 const firstYear=history.length?Number(history[history.length-1].year)+1:new Date().getFullYear();
 const forecasts=inp.forecasts?.length?inp.forecasts:[null,null,null,null,null];
 $('valuation-content').innerHTML=renderPricePanel()+`<div class="panel"><h3>${esc(stock.name)} · FCFF / WACC</h3><p class="small muted">${valuation?'正在显示已保存情景。':'财报已生成可编辑的现金流草案。'}金额为亿元，股本为亿股；填入贴现率（WACC）和永续增长率后，系统自动折现并与股价比较。WACC 是公司资金成本的加权平均，数值越高，未来现金流折算到今天通常越少；新情景会自动带入下方分步计算的 WACC；已保存情景保留原值，修改后需重新确认保存。</p>${dcf_draft?`<p class="notice small">${esc(dcf_draft.method)}。${dcf_draft.missing.length?'待补：'+esc(dcf_draft.missing.join('；'))+'。':''}自动草案不等于经审核的预测。</p>`:''}<form id="dcf-form"><div class="fcff-head"><div><h4>历史与未来 FCFF <span class="small muted">亿元</span></h4><p class="small muted">历史来自财报；预测金额可逐年修改，曲线实时更新。</p></div><div class="fcff-legend"><span><i class="fcff-key history"></i>历史财报</span><span><i class="fcff-key forecast"></i>你的预测</span></div></div><div id="fcff-chart" class="fcff-chart-wrap" aria-label="历史和未来自由现金流折线图"></div><div id="fcff-point-detail" class="chart-selection" aria-live="polite">点击曲线上的圆点，查看该年的金额与数据类型。</div><div class="fcff-input-head"><strong>未来各年预测</strong><span class="small muted">每年 FCFF，亿元</span></div><div id="forecast-fields" class="forecast-fields" data-first-year="${firstYear}">${forecasts.map((v,i)=>forecastField(firstYear+i,v==null?'':v/1e8)).join('')}</div><div class="fcff-actions"><button type="button" id="add-forecast-year" ${forecasts.length>=20?'disabled':''}>＋ 增加一年</button><button type="button" id="remove-forecast-year" ${forecasts.length<=1?'disabled':''}>减少末年</button><span class="small muted">最多预测 20 年；请核对永续期再投资需求。</span></div><div class="form-row"><label class="field">贴现率 WACC（%）<input type="number" name="wacc" step="any" value="${inp.wacc==null?'':inp.wacc*100}" required></label><label class="field">永续增长率（%）<input type="number" name="terminal_growth" step="any" value="${inp.terminal_growth==null?'':inp.terminal_growth*100}" required></label></div><div class="dcf-fill-row"><button type="button" id="dcf-use-current-wacc" disabled>填入当前口径 WACC</button><span class="small muted">当前口径＝最近一个交易日的参数（β 回归、股权溢价、无风险利率、债务成本），来源与时点见公司页「资本回报怎么看」与「WACC 分步计算」；新情景自动采用计算结果；可在上方这一处调整 WACC，并在下方依据中说明原因。已保存情景保留原值，点击按钮可改用当前计算结果。永续增长率没有任何官方值，只能你自己判断——代填会直接改变估值的量级，所以这里不预填。</span></div><div class="form-row">${[['cash','可加回的非经营性现金（亿元）'],['other_assets','其他非经营性资产（亿元）'],['debt','有息债务（亿元）'],['minority','少数股东权益调整（亿元）'],['other_claims','其他优先索取权（亿元）'],['shares','总股本（亿股）']].map(([key,label])=>`<label class="field">${label}<input type="number" name="${key}" step="any" min="0" value="${inp[key]==null?'':Number((inp[key]/1e8).toFixed(key==='shares'?6:4))}" required></label>`).join('')}</div><p class="small muted">${quote?.shares?'行情股本参考：'+num(quote.shares/1e8,6)+' 亿股，日期 '+esc(quote.trade_date)+'。':''}财报货币资金不能直接全部视为可加回现金；请核对受限和经营所需资金。</p><label class="field">预测及调整依据（WACC、增长、利润率、再投资、永续期和股本）<textarea name="basis" required>${esc(inp.basis||'')}</textarea></label><label class="checkline"><input type="checkbox" name="confirmed" required>我已核对预测口径、再投资需求、现金债务调整、少数股东权益及股本</label><button class="primary" type="submit">计算并保存基准情景</button></form></div><div id="value-result"></div>`;
 renderPriceChart(klineDays,klinePeriod);
 updateWaccFillButtons();
 renderQuoteFacts();
 renderFcffChart();
 if(valuation)renderValue(valuation);
}
function klineLimitRate(code){
 const c=String(code||'');
 if(/^(300|301|688|689)/.test(c))return 0.2;
 if(/^(4|8|92)/.test(c))return 0.3;
 return 0.1;
}
function quoteFacts(quote){
 const history=(quote.history||[]).filter(r=>/^\d{8}$/.test(String(r.trade_date))&&Number(r.close)>0).sort((a,b)=>String(a.trade_date).localeCompare(String(b.trade_date)));
 const last=history[history.length-1]||{},prev=history[history.length-2]||{};
 const close=Number(last.close)||null,prevClose=Number(prev.close)||null;
 const open=klineNum(last.open),high=klineNum(last.high),low=klineNum(last.low);
 const volume=klineNum(last.volume),amount=klineNum(last.amount),turnover=klineNum(last.turnover);
 const shares=klineNum(quote.shares);
 const change=close!=null&&prevClose!=null?close-prevClose:null;
 const archive=detail.financial_archive||{},annual=archive.annual||[];
 const lastYear=[...annual].reverse().find(row=>row.income||row.derived)||{};
 const profit=klineNum(lastYear.income?.n_income_attr_p);
 const eps=profit!=null&&shares>0?profit/shares:null;
 const rate=klineLimitRate(selected);
 // 换手率：行情源未提供时按当日成交量（手）与当前总股本估算
 const turnoverValue=turnover!=null?turnover:(shares>0&&volume!=null?volume*100/shares*100:null);
 const turnoverEstimated=turnover==null&&turnoverValue!=null;
 // 市净率：优先取档案已核对值；股本变动等不可比情形退回到按当前总股本摊薄的估算
 const book=archive.latest_book_to_price||{};
 const equityRow=[...annual].reverse().find(row=>(row.derived||{}).book_value_attributable!=null);
 const equity=klineNum(equityRow?.derived?.book_value_attributable);
 const statementShares=klineNum(equityRow?.balance_sheet?.total_share);
 let priceToBook=klineNum(book.price_to_book),pbEstimated=false,pbNote='';
 if(priceToBook==null&&equity!=null&&equity>0&&shares>0&&close>0){
  priceToBook=close*shares/equity;
  pbEstimated=true;
  pbNote=statementShares>0&&statementShares>0
   ?`年报期末股本 ${num(statementShares/1e8,2)} 亿股与当前总股本 ${num(shares/1e8,2)} 亿股相差 ${shares/statementShares>=1?'+':''}${num((shares/statementShares-1)*100,1)}%，市净率按当前总股本摊薄估算，须核对增发、回购或送转后使用`
   :'缺少年报期末股本，市净率按当前总股本摊薄估算';
 }
 return {date:String(last.trade_date||''),close,prevClose,open,high,low,volume,amount,turnover:turnoverValue,shares,
  change,changePct:change!=null&&prevClose>0?change/prevClose*100:null,
  amplitude:high!=null&&low!=null&&prevClose>0?(high-low)/prevClose*100:null,
  marketCap:shares>0&&close?shares*close:null,
  limitRate:rate,limitUp:prevClose>0?Math.round(prevClose*(1+rate)*100)/100:null,
  peStatic:eps>0&&close?close/eps:null,year:lastYear.year||null,
  turnoverEstimated,priceToBook,pbEstimated,pbNote,bookStatus:book.status||'',bookYear:book.book_year||null};
}
function renderQuoteFacts(){
 const box=$('quote-facts');if(!box)return;
 const f=quoteFacts(detail.quote||{});
 const dash='—';
 const dir=(v)=>v==null?'':(v>0?'up':v<0?'down':'');
 const cell=(label,value,cls='')=>`<div class="quote-fact"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
 const items=[
  cell('今开',f.open!=null?num(f.open):dash,dir(f.open!=null&&f.prevClose!=null?f.open-f.prevClose:null)),
  cell('最高',f.high!=null?num(f.high):dash,dir(f.high!=null&&f.prevClose!=null?f.high-f.prevClose:null)),
  cell('昨收',f.prevClose!=null?num(f.prevClose):dash),
  cell('最低',f.low!=null?num(f.low):dash,dir(f.low!=null&&f.prevClose!=null?f.low-f.prevClose:null)),
  cell('换手率',f.turnover!=null?num(f.turnover)+'%':dash),
  cell('振幅',f.amplitude!=null?num(f.amplitude,2)+'%':dash),
  cell('成交量',f.volume!=null?num(f.volume/10000,2)+' 万手':dash),
  cell('成交额',f.amount!=null?yi(f.amount)+' 亿':dash),
  cell('总市值',f.marketCap!=null?yi(f.marketCap)+' 亿':dash),
  cell('总股本',f.shares!=null?num(f.shares/1e8,2)+' 亿股':dash),
  cell('涨停价',f.limitUp!=null?num(f.limitUp):dash),
  cell('市盈率(静)',f.peStatic!=null?num(f.peStatic,2):dash),
  cell(f.pbEstimated?'市净率(估)':'市净率',f.priceToBook!=null?num(f.priceToBook,2):dash)];
 box.innerHTML=items.join('')
  +`<p class="small muted quote-facts-note">数据为最近交易日 ${esc(f.date||'待获取')} 的未复权日线：今开/最高/最低/振幅/成交量/成交额直接取当日值；总市值＝收盘价×当前总股本，股本变动期间只作参考。${f.turnoverEstimated?'换手率由成交量÷当前总股本估算，不是行情源直接给出的值。':''}${f.year?`市盈率(静)按 ${esc(f.year)} 年报归母净利润与当前股本计算，不是 TTM；`:''}${f.pbEstimated?`${esc(f.pbNote)}。`:''}涨停价按所属板块 ${num(f.limitRate*100,0)}% 规则估算。量比、委比、内盘需要实时分时与委托数据，本工具不取，故不显示。</p>`;
}
function quoteRangeLabel(quote){
 const hist=quote?.history||[];
 if(!hist.length)return'暂无日线';
 const fmt=d=>String(d||'').length===8?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:String(d||'');
 const first=fmt(quote.history_start||hist[0].trade_date),last=fmt(hist[hist.length-1].trade_date);
 const days=Number(quote.history_days)||hist.length;
 return `${first} 至 ${last}，共 ${days} 个交易日`;
}
function renderPricePanel(){
 const quote=detail.quote||{},entry=state.rows.find(r=>r.symbol===selected),comparison=entry?.comparison;
 const value=entry?.valuation?.result?.per_share,price=Number(quote.close),hasPrice=Number.isFinite(price)&&price>0;
 const date=String(quote.trade_date||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const margin=comparison?.state==='compared'&&comparison.margin!=null?pct(comparison.margin):'待核对';
 const threshold=state.quality_policy.margin_min/100;
 const cross=quote.cross_check||{};
 const crossText=cross.state==='matched'?`BaoStock 同日价格吻合 · ST ${cross.is_st?'是':'否'} · ${cross.trade_date}`:cross.state==='st_warning'?`BaoStock 同日标记 ST · ${cross.trade_date}，暂停候选`:cross.state==='mismatch'?`BaoStock 同日价格不一致 · 差 ${num(cross.difference_pct,3)}%，暂停安全边际判断`:cross.state==='different_date'?`BaoStock 最近可得日期 ${cross.trade_date}，与主报价不同日，未作比较`:cross.state==='unavailable'?'BaoStock 暂不可用，需核对交易所公告':'BaoStock 尚未核对';
 return `<div class="panel price-panel"><div class="price-head"><div><h3>股价走势与安全边际</h3><p class="small muted"><span id="price-source">${esc(quote.source||'行情来源待获取')} · 未复权日收盘价</span> · ${esc(quoteRangeLabel(quote))}；更新 ${esc(quote.fetched_at||'待获取')}，不是实时行情</p></div><button type="button" id="refresh-quote">更新这只股票的价格</button></div><p class="small muted">${esc(crossText)}${cross.source_url?` · <a href="${esc(cross.source_url)}" target="_blank" rel="noopener">数据说明</a>`:''}</p><div class="price-metrics"><div><span>最近收盘价</span><strong>${hasPrice?'¥'+num(price):'待获取'}</strong><small>${esc(date||'无报价日期')}</small></div><div><span>DCF 每股价值</span><strong>${value>0?'¥'+num(value):'待审核估值'}</strong><small>${value>0?'已保存的有效估值':'完成公司审核并保存 DCF 后显示'}</small></div><div><span>当前安全边际</span><strong class="${comparison?.margin>=threshold?'margin-good':''}">${margin}</strong><small>${comparison?.state==='compared'?'1 − 收盘价 ÷ 每股价值':esc(comparison?.reason||'需有效估值与近期收盘价')}</small></div></div>${value>0?`<p class="price-threshold">${state.quality_policy.margin_min}% 安全边际对应价格：<strong>¥${num(value*(1-threshold))}</strong> / 股。低于该价才满足本工具的价格门槛；公司仍须通过定性审核。</p>`:''}<div class="price-controls"><div class="price-legend"><span><i class="price-key market"></i>K 线（开高低收）</span><span><span class="ma-legend"><i class="price-key ma" data-ma="ma5"></i><i class="price-key ma" data-ma="ma10"></i><i class="price-key ma" data-ma="ma20"></i><i class="price-key ma" data-ma="ma30"></i></span>均线 MA5 / MA10 / MA20 / MA30（点上方数字可隐藏）</span>${value>0?`<span><i class="price-key value"></i>DCF 每股价值</span><span><i class="price-key threshold"></i>${state.quality_policy.margin_min}% 安全边际价格</span>`:''}</div><div class="price-periods"><button type="button" data-kline-period="day">日 K</button><button type="button" data-kline-period="week">周 K</button><button type="button" data-kline-period="month">月 K</button><button type="button" data-kline-period="quarter">季 K</button><button type="button" data-kline-period="year">年 K</button><span class="period-split"></span><button type="button" data-price-days="31">1 月</button><button type="button" data-price-days="93">3 月</button><button type="button" data-price-days="370">1 年</button><button type="button" data-price-days="all">上市至今</button><span class="period-split"></span><span class="small muted">复权</span>${KLINE_ADJUSTS.map(([key,label])=>`<button type="button" data-kline-adjust="${key}"${klineAdjustAvailable()?'':' disabled'}>${label}</button>`).join('')}</div></div><p class="small muted" id="kline-adjust-note">${esc(klineAdjustNote())}</p><div class="quote-facts" id="quote-facts"></div><div class="kline-head" id="kline-head"></div><div class="price-chart-wrap"><div id="price-chart" class="kline-canvas" tabindex="0" role="img" aria-label="股票日 K 线、均线与成交量图；点击任意一根 K 线或用左右方向键查看当日明细"></div><p class="small muted price-empty" id="kline-empty" hidden>还没有价格走势。点击“更新这只股票的价格”获取上市至今的日 K 线。</p></div><div class="kline-detail" id="kline-detail"></div><p class="small muted">${comparison?.state==='pending'?'最近报价未满足有效期，请更新并核对停牌或长假。 ':''}点击任意一根 K 线可查看当日的开高低收、成交量与安全边际；图表获得焦点后可用 ← → 逐日浏览，按住 Ctrl 滚轮缩放。未复权价格遇分红、送转等可能出现跳变；历史估值线只是把当前 DCF 情景用于对照，不代表过去每一天的已知价值。</p></div>`;
}
function renderPriceChart(days,period){
 klineDays=(days==='all')?'all':(Number(days)||370);klinePeriod=period||'day';
 paintMaColors();
 for(const button of document.querySelectorAll('[data-price-days]'))button.classList.toggle('active',String(button.dataset.priceDays)===String(klineDays));
 for(const button of document.querySelectorAll('[data-kline-period]'))button.classList.toggle('active',button.dataset.klinePeriod===klinePeriod);
 if(!klineAdjustAvailable())klineAdjust='none';
 for(const button of document.querySelectorAll('[data-kline-adjust]'))button.classList.toggle('active',button.dataset.klineAdjust===klineAdjust);
 const host=$('price-chart');if(!host)return;
 const rows=aggregateKline(klineRangeRows(klineSourceRows(),klineDays),klinePeriod).map(sanitizeKline);
 klineRows=rows;klineSelected=-1;
 const empty=$('kline-empty');
 if(rows.length<2){
  priceChart?.dispose();priceChart=null;priceChartObserver?.disconnect();priceChartObserver=null;
  host.hidden=true;if(empty)empty.hidden=false;
  const head=$('kline-head'),box=$('kline-detail');if(head)head.innerHTML='';if(box)box.innerHTML='';
  return;
 }
 host.hidden=false;if(empty)empty.hidden=true;
 mountKline(klineOption(rows));
 renderKlineHead(rows.length-1);
 renderKlineDetail();
 updatePriceAdjustLabels();
}
function klineAdjustAvailable(){const quote=detail?.quote||{};return quote.adj_complete===true&&Number(quote.adj_factor_latest)>0;}
function klineAdjustScale(date){
 if(klineAdjust==='none')return 1;
 const quote=detail?.quote||{},factor=Number((quote.adj_factors||{})[date]),last=Number(quote.adj_factor_latest);
 if(!factor||!last)return 1;
 return klineAdjust==='qfq'?factor/last:factor;
}
// 估值线与价格共用一根轴：不复权与前复权都是今天的价格单位，后复权要按最新因子换算。
function klineLineScale(){const quote=detail?.quote||{};return klineAdjust==='hfq'?(Number(quote.adj_factor_latest)||1):1;}
function klineAdjustShort(){return klineAdjust==='qfq'?'前复权':klineAdjust==='hfq'?'后复权':'不复权';}
function klineAdjustNote(){
 if(!klineAdjustAvailable())return `复权因子不完整（缺 ${detail?.quote?.adj_missing??'—'} 个交易日），暂不提供复权序列；图中是未复权日收盘价。`;
 if(klineAdjust==='qfq')return '图中为前复权：历史价格按分红送转折算到今天的价格单位，最新一根等于实际收盘价；成交量与成交额是实际成交值。';
 if(klineAdjust==='hfq')return '图中为后复权：纵轴单位是后复权价，不是实际成交价；市值、市净率、安全边际仍按当日实际价计算。';
 return '图中为未复权日收盘价；除权除息日会出现价格跳空，不代表真实跌幅。';
}
function updatePriceAdjustLabels(){
 const source=$('price-source'),note=$('kline-adjust-note');
 if(source)source.textContent=`${detail?.quote?.source||'行情来源待获取'} · ${klineAdjustLabel()}`;
 if(note)note.textContent=klineAdjustNote();
}
function klineAdjustLabel(){
 return klineAdjust==='qfq'?'前复权日收盘价（历史价格已折算到今天的价格单位）'
  :klineAdjust==='hfq'?'后复权日收盘价（纵轴上的单位是后复权价，不是实际成交价）'
  :'未复权日收盘价';
}
function klineSourceRows(){
 const quote=detail.quote||{};
 return (quote.history||[]).filter(r=>/^\d{8}$/.test(String(r.trade_date))&&Number.isFinite(Number(r.close))&&Number(r.close)>0)
  .sort((a,b)=>a.trade_date.localeCompare(b.trade_date))
  .map(r=>{
   const factor=klineAdjustScale(String(r.trade_date));
   const scaled=value=>{const n=klineNum(value);return n==null?null:n*factor;};
   const close=Number(r.close);
   return {date:String(r.trade_date),open:scaled(r.open),high:scaled(r.high),low:scaled(r.low),close:close*factor,
    rawOpen:klineNum(r.open),rawHigh:klineNum(r.high),rawLow:klineNum(r.low),rawClose:close,
    volume:klineNum(r.volume),amount:klineNum(r.amount),turnover:klineNum(r.turnover)};
  });
}
function klineNum(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function sanitizeKline(row){
 const {open,high,low,close}=row;
 if(open!=null&&high!=null&&low!=null&&high>=Math.max(open,close)&&low<=Math.min(open,close)&&low>0)return row;
 return {...row,open:null,high:null,low:null};
}
function klinePeriodKey(date,period){
 const y=Number(date.slice(0,4)),m=Number(date.slice(4,6)),d=Number(date.slice(6,8));
 if(period==='month')return `${y}-${String(m).padStart(2,'0')}`;
 if(period==='quarter')return `${y}-Q${Math.floor((m-1)/3)+1}`;
 if(period==='year')return `${y}`;
 const stamp=Date.UTC(y,m-1,d),offset=(new Date(stamp).getUTCDay()+6)%7,monday=new Date(stamp-offset*86400000);
 return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth()+1).padStart(2,'0')}-${String(monday.getUTCDate()).padStart(2,'0')}`;
}
function aggregateKline(rows,period){
 if(period==='day')return rows;
 const map=new Map();
 for(const row of rows){
  const key=klinePeriodKey(row.date,period);
  let bar=map.get(key);
  if(!bar){bar={key,date:row.date,open:row.open,high:row.high,low:row.low,close:row.close,volume:row.volume,amount:row.amount,turnover:null};map.set(key,bar);}
  else{
   if(row.high!=null)bar.high=bar.high==null?row.high:Math.max(bar.high,row.high);
   if(row.low!=null)bar.low=bar.low==null?row.low:Math.min(bar.low,row.low);
   if(bar.open==null)bar.open=row.open;
   bar.close=row.close;bar.date=row.date;
   if(row.volume!=null)bar.volume=(bar.volume||0)+row.volume;
   if(row.amount!=null)bar.amount=(bar.amount||0)+row.amount;
  }
 }
 return [...map.values()];
}
function klineRangeRows(rows,days){
 if(!rows.length||days==='all')return rows;
 const last=rows[rows.length-1].date,utc=Date.UTC(Number(last.slice(0,4)),Number(last.slice(4,6))-1,Number(last.slice(6,8)));
 return rows.filter(r=>utc-Date.UTC(Number(r.date.slice(0,4)),Number(r.date.slice(4,6))-1,Number(r.date.slice(6,8)))<=days*86400000);
}
function klineMaSeries(values,period){
 const out=[];
 for(let i=0;i<values.length;i++){
  if(i<period-1){out.push(null);continue;}
  let sum=0;for(let j=i-period+1;j<=i;j++)sum+=values[j];
  out.push(sum/period);
 }
 return out;
}
function klineFacts(idx){
 const row=klineRows[idx];if(!row)return null;
 const prev=klineRows[idx-1];
 const change=prev?row.close-prev.close:null;
 const changePct=prev&&prev.close?change/prev.close:null;
 const shares=klineNum(detail.quote?.shares);
 const marketCap=shares&&shares>0?shares*row.rawClose:null;
 const turnover=row.turnover!=null?row.turnover:(shares>0&&row.volume!=null?row.volume*100/shares*100:null);
 const turnoverEstimated=row.turnover==null&&turnover!=null;
 const value=state.rows.find(r=>r.symbol===selected)?.valuation?.result?.per_share;
 const threshold=state.quality_policy.margin_min/100;
 // 安全边际对照的是 DCF 当下的每股价值，用当日实际收盘价，不用复权价。
 const margin=value>0?1-row.rawClose/value:null;
 return {row,prev,change,changePct,shares,marketCap,turnover,turnoverEstimated,value,threshold,margin};
}
function klineOption(rows){
 const dates=rows.map(r=>r.date),closes=rows.map(r=>r.close);
 const hasOhlc=rows.some(r=>r.open!=null&&r.high!=null&&r.low!=null);
 const hasVolume=rows.some(r=>r.volume!=null);
 const ma5=klineMaSeries(closes,5),ma10=klineMaSeries(closes,10),ma20=klineMaSeries(closes,20),ma30=klineMaSeries(closes,30);
 klineMa={ma5,ma10,ma20,ma30};
 const value=state.rows.find(r=>r.symbol===selected)?.valuation?.result?.per_share;
 const threshold=state.quality_policy.margin_min/100;
 const lines=[];
 if(value>0){
  const scale=klineLineScale(),suffix=klineAdjust==='hfq'?'（后复权口径）':'';
  lines.push({yAxis:value*scale,lineStyle:{color:'#276a52',type:'dashed',width:1.4},label:{formatter:`DCF 每股价值 ¥${num(value*scale)}${suffix}`,position:'insideEndTop',color:'#276a52',fontSize:11,fontWeight:600}});
  lines.push({yAxis:value*(1-threshold)*scale,lineStyle:{color:'#bb9b5d',type:'dotted',width:1.4},label:{formatter:`${state.quality_policy.margin_min}% 安全边际 ¥${num(value*(1-threshold)*scale)}${suffix}`,position:'insideEndBottom',color:'#8a6f38',fontSize:11}});
 }
 const axisLine={lineStyle:{color:'#d9dfd8'}},axisTick={show:false},labelStyle={color:'#829087',fontSize:11};
 const grid=hasVolume?[{left:58,right:22,top:26,height:'54%'},{left:58,right:22,top:'72%',height:'14%'}]:[{left:58,right:22,top:26,height:'70%'}];
 const xAxis=hasVolume?[
  {type:'category',data:dates,gridIndex:0,axisLine,axisTick,axisLabel:{show:false},splitLine:{show:false}},
  {type:'category',data:dates,gridIndex:1,axisLine,axisTick,axisLabel:{...labelStyle,hideOverlap:true},splitLine:{show:false}}
 ]:[{type:'category',data:dates,gridIndex:0,axisLine,axisTick,axisLabel:{...labelStyle,hideOverlap:true},splitLine:{show:false}}];
 const yAxis=hasVolume?[
  {type:'value',scale:true,gridIndex:0,splitLine:{lineStyle:{color:'#eef1ec'}},axisLine:{show:false},axisTick:{show:false},axisLabel:{...labelStyle,formatter:v=>num(v,0)}},
  {type:'value',scale:true,gridIndex:1,splitNumber:2,splitLine:{show:false},axisLine:{show:false},axisTick:{show:false},axisLabel:{...labelStyle,formatter:v=>num(v/10000,1)+'万'}}
 ]:[{type:'value',scale:true,gridIndex:0,splitLine:{lineStyle:{color:'#eef1ec'}},axisLine:{show:false},axisTick:{show:false},axisLabel:{...labelStyle,formatter:v=>num(v,0)}}];
 const priceSeries=hasOhlc
  ?{name:'日K',type:'candlestick',data:rows.map(r=>[r.open,r.close,r.low,r.high]),xAxisIndex:0,yAxisIndex:0,barMaxWidth:13,itemStyle:{color:KLINE_UP,color0:KLINE_DOWN,borderColor:KLINE_UP,borderColor0:KLINE_DOWN,borderWidth:1},markLine:{silent:true,symbol:'none',data:lines,label:{show:true}},markPoint:{data:[]}}
  :{name:'收盘价',type:'line',data:closes,xAxisIndex:0,yAxisIndex:0,smooth:false,showSymbol:false,lineStyle:{color:'#c77963',width:2},itemStyle:{color:'#c77963'},markLine:{silent:true,symbol:'none',data:lines,label:{show:true}},markPoint:{data:[]}};
 const maSeries=KLINE_MA_KEYS.filter(([key])=>klineMaVisible[key]).map(([key,name,color])=>({name,type:'line',data:klineMa[key],smooth:true,symbol:'none',lineStyle:{width:1.2,color},xAxisIndex:0,yAxisIndex:0,emphasis:{disabled:true},z:3}));
 const volumeSeries=hasVolume?{name:'成交量',type:'bar',xAxisIndex:1,yAxisIndex:1,barMaxWidth:13,data:rows.map((r,i)=>{const prev=rows[i-1],up=!prev||r.close>=prev.close;return {value:r.volume??0,itemStyle:{color:up?KLINE_UP:KLINE_DOWN}};})}:null;
 return {
  animation:false,
  backgroundColor:'transparent',
  tooltip:{trigger:'axis',confine:true,backgroundColor:'rgba(255,255,255,.97)',borderColor:'#d9dfd8',borderWidth:1,textStyle:{color:'#2c3a33',fontSize:12},extraCssText:'box-shadow:0 10px 26px rgba(44,58,51,.13);border-radius:8px;padding:0;',axisPointer:{type:'cross',crossStyle:{color:'#9aa79d'},lineStyle:{color:'#9aa79d'},label:{backgroundColor:'#4b5a51',fontSize:11}},formatter:klineTooltip},
  axisPointer:{link:[{xAxisIndex:'all'}]},
  grid,xAxis,yAxis,
  dataZoom:[{type:'inside',xAxisIndex:hasVolume?[0,1]:[0],zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false,moveOnMouseMove:true},
  {type:'slider',xAxisIndex:hasVolume?[0,1]:[0],bottom:4,height:16,borderColor:'#d9dfd8',backgroundColor:'#fafbf8',fillerColor:'rgba(39,106,82,0.10)',handleStyle:{color:'#276a52'},moveHandleSize:4,dataBackground:{lineStyle:{color:'#c3cec6'},areaStyle:{color:'#e6ece7'}},selectedDataBackground:{lineStyle:{color:'#276a52'},areaStyle:{color:'#cfe0d6'}},textStyle:{color:'#829087',fontSize:10}}],
  series:[priceSeries,...maSeries,...(volumeSeries?[volumeSeries]:[])]
 };
}
function klineTooltip(params){
 const list=Array.isArray(params)?params:[params];
 const hit=list.find(p=>p.seriesType==='candlestick'||p.seriesType==='line');
 if(!hit)return '';
 const facts=klineFacts(hit.dataIndex);
 if(!facts)return '';
 const {row,change,changePct}=facts;
 // 涨跌色用 CSS 类表达：行内 style 属性会被服务器 CSP 的 style-src 'self' 屏蔽。
 const tone=v=>v==null?'flat':(v>=0?'up':'down');
 const cell=(label,text,toneClass)=>`<div class="kline-tip-row"><span>${label}</span><b class="kline-tip-val${toneClass?' '+toneClass:''}">${text}</b></div>`;
 return `<div class="kline-tip"><div class="kline-tip-date">${esc(row.date.slice(0,4)+'-'+row.date.slice(4,6)+'-'+row.date.slice(6,8))}</div>`
  +cell('开盘',row.open!=null?num(row.open):'—')
  +cell('收盘',num(row.close),tone(change))
  +cell('最高',row.high!=null?num(row.high):'—')
  +cell('最低',row.low!=null?num(row.low):'—')
  +cell('涨跌额',change==null?'—':(change>=0?'+':'')+num(change),tone(change))
  +cell('涨跌幅',changePct==null?'—':(changePct>=0?'+':'')+num(changePct*100)+'%',tone(change))
  +cell('成交量',row.volume!=null?num(row.volume/10000)+' 万手':'—')
  +cell('成交额',row.amount!=null?yi(row.amount)+' 亿':'—')
  +(facts.turnover!=null?cell('换手率'+(facts.turnoverEstimated?'(估)':''),num(facts.turnover)+'%'):'')
  +'</div>';
}
function mountKline(option){
 const host=$('price-chart');
 if(!host||!window.echarts)return;
 if(!host.clientWidth){klinePending=true;return;}
 klinePending=false;
 if(!priceChart||priceChart.getDom()!==host){
  priceChartObserver?.disconnect();priceChartObserver=null;
  priceChart?.dispose();
  priceChart=echarts.init(host);
  priceChart.on('click',onKlineClick);
  host.addEventListener('click',onKlineDomClick);
  host.addEventListener('keydown',onKlineKeydown);
  priceChart.on('updateAxisPointer',onKlinePointer);
  priceChartObserver=new ResizeObserver(()=>{if(host.isConnected)priceChart?.resize();});
  priceChartObserver.observe(host);
 }
 priceChart.setOption(option,true);
}
function onKlineClick(params){
 const idx=params.dataIndex;
 if(typeof idx!=='number'||idx<0||idx>=klineRows.length)return;
 selectKline(idx);
}
function onKlineDomClick(event){
 // 逐根点选：按横坐标就近吸附，密集的一年日线也能点准。
 if(!priceChart||!klineRows.length)return;
 const canvas=event.target&&event.target.closest?event.target.closest('canvas'):null;
 const box=(canvas||event.currentTarget).getBoundingClientRect();
 const x=event.clientX-box.left;
 const first=Number(priceChart.convertToPixel({xAxisIndex:0},0));
 const last=Number(priceChart.convertToPixel({xAxisIndex:0},klineRows.length-1));
 if(!Number.isFinite(first)||!Number.isFinite(last)||last===first)return;
 const ratio=(x-first)/(last-first);
 const idx=Math.max(0,Math.min(klineRows.length-1,Math.round(ratio*(klineRows.length-1))));
 selectKline(idx);
}
function klineStep(key,current,total){
 if(!total)return null;
 if(key==='ArrowLeft')return Math.max(0,current-1);
 if(key==='ArrowRight')return Math.min(total-1,current+1);
 if(key==='Home')return 0;
 if(key==='End')return total-1;
 return null;
}
function onKlineKeydown(event){
 const current=klineSelected>=0?klineSelected:klineRows.length-1;
 const next=klineStep(event.key,current,klineRows.length);
 if(next===null)return;
 event.preventDefault();
 selectKline(next);
}
function selectKline(idx){
 klineSelected=idx;
 renderKlineHead(idx);
 renderKlineDetail();
 const row=klineRows[idx];
 const host=$('price-chart');
 if(host&&document.activeElement!==host){try{host.focus({preventScroll:true});}catch{host.focus();}}
 if(!priceChart||!row)return;
 priceChart.setOption({series:[{markPoint:{data:[{coord:[idx,row.high??row.close],symbol:'circle',symbolSize:9,itemStyle:{color:'#c77963',borderColor:'#ffffff',borderWidth:2},label:{show:true,position:'top',formatter:()=>row.date.slice(4,6)+'/'+row.date.slice(6,8),color:'#5b6b62',fontSize:11,fontWeight:600}}]}}]});
}
function onKlinePointer(event){
 // 只在鼠标真正移动时更新均线栏，避免初始化指针把均线栏顶回第一根。
 if(event.currTrigger!=='mousemove')return;
 let idx=typeof event.dataIndex==='number'?event.dataIndex:-1;
 if(idx<0&&event.axesInfo&&event.axesInfo.length)idx=typeof event.axesInfo[0].value==='number'?event.axesInfo[0].value:-1;
 if(idx>=0&&idx<klineRows.length)renderKlineHead(idx);
}
// 均线颜色统一取自 KLINE_MA_KEYS，保证行情头数字、图例色块与图里的线一一对应。
// 这里用 CSSOM 赋值而不是行内 style 属性：服务器 CSP 的 style-src 'self' 会屏蔽所有行内样式。
function paintMaColors(){
 for(const el of document.querySelectorAll('[data-ma]')){
  const key=el.dataset.ma,entry=KLINE_MA_KEYS.find(item=>item[0]===key);
  if(!entry)continue;
  const color=klineMaVisible[key]===false?'#a7b1a9':entry[2];
  if(el.classList.contains('price-key'))el.style.borderTopColor=color;
  else el.style.color=color;
 }
}
function renderKlineHead(idx){
 const bar=$('kline-head');if(!bar)return;
 const row=klineRows[idx];if(!row){bar.innerHTML='';return;}
 const parts=KLINE_MA_KEYS.map(([key,label])=>{
  const value=klineMa[key]?klineMa[key][idx]:null,on=klineMaVisible[key];
  return `<button type="button" class="kline-ma${on?'':' off'}" data-ma-toggle="${key}" data-ma="${key}" aria-pressed="${on}" title="点击${on?'隐藏':'显示'} ${label}">${label} ${value==null?'—':num(value)}</button>`;
 });
 bar.innerHTML=`<span class="kline-head-title">${esc(row.date.slice(0,4)+'-'+row.date.slice(4,6)+'-'+row.date.slice(6,8))}</span>`
  +parts.join('');
 paintMaColors();
}
function toggleKlineMa(key){
 if(!(key in klineMaVisible))return;
 klineMaVisible[key]=!klineMaVisible[key];
 if(klineRows.length){
  mountKline(klineOption(klineRows));
  selectKline(klineSelected>=0?klineSelected:klineRows.length-1);
 }else renderKlineHead(-1);
}
function renderKlineDetail(){
 const box=$('kline-detail');if(!box)return;
 const idx=klineSelected>=0?klineSelected:klineRows.length-1;
 const facts=klineFacts(idx);
 if(!facts){box.innerHTML='';return;}
 const {row,change,changePct,marketCap,turnover,turnoverEstimated,value,threshold,margin}=facts;
 const tone=v=>v==null?'':(v>=0?'up':'down');
 const item=(label,text,cls='')=>`<div class="kline-detail-item ${cls}"><span>${label}</span><strong>${text}</strong></div>`;
 const reached=value>0&&margin!=null&&margin>=threshold;
 const adjusted=klineAdjust!=='none';
 box.innerHTML=`<div class="kline-detail-head"><strong>${esc(row.date.slice(0,4)+'-'+row.date.slice(4,6)+'-'+row.date.slice(6,8))}</strong><span class="small muted">${adjusted?`${klineAdjustShort()}口径；`:''}${klineSelected>=0?'已选中这一根 K 线；点击图中任意一根可切换':'默认显示最后一根；点击图中任意一根 K 线可查看当日明细'}</span></div>`
  +'<div class="kline-detail-grid">'
  +item('开盘',row.open!=null?'¥'+num(row.open):'—')
  +item('最高',row.high!=null?'¥'+num(row.high):'—')
  +item('最低',row.low!=null?'¥'+num(row.low):'—')
  +item('收盘','¥'+num(row.close),tone(change))
  +(adjusted&&row.rawClose!=null&&Math.abs(row.rawClose-row.close)>1e-9?item('实际收盘价','¥'+num(row.rawClose)):'' )
  +item('涨跌额',change==null?'—':(change>=0?'+':'')+num(change),tone(change))
  +item('涨跌幅',changePct==null?'—':(changePct>=0?'+':'')+num(changePct*100)+'%',tone(change))
  +item('成交量',row.volume!=null?num(row.volume/10000)+' 万手':'—')
  +item('成交额',row.amount!=null?yi(row.amount)+' 亿':'—')
  +(turnover!=null?item('换手率'+ (turnoverEstimated?'(估)':''),num(turnover)+'%'):'')
  +(marketCap!=null?item('当日总市值',yi(marketCap)+' 亿'):'')
  +'</div>'
  +(value>0?`<p class="small ${reached?'kline-hit':'kline-miss'}">按当日实际收盘价 ¥${num(row.rawClose)} 计算，DCF 每股价值 ¥${num(value)} 对应的安全边际为 <strong>${pct(margin)}</strong>，${reached?`已达到 ${state.quality_policy.margin_min}% 门槛`:`未达到 ${state.quality_policy.margin_min}% 门槛`}。安全边际只是价格条件，不能替代公司审核。</p>`
   :'<p class="small muted">保存有效的 DCF 估值后，这里会显示这一天收盘价对应的安全边际。</p>');
}
function forecastField(year,value){return `<label class="field forecast-field">${year} 年<input type="number" name="forecast" data-fcff-year="${year}" step="any" value="${value===''?'':esc(Number(value).toFixed(4))}" required></label>`;}
function selectFcffPoint(point){
 const chart=$('fcff-chart'),panel=$('fcff-point-detail');if(!chart||!panel||!point)return;
 for(const marker of chart.querySelectorAll('[data-fcff-point]'))marker.classList.toggle('selected',marker===point);
 const year=Number(point.dataset.fcffYear),value=Number(point.dataset.fcffValue),kind=point.dataset.fcffKind;
 fcffSelectedYear=year;
 panel.innerHTML=`<strong>${year} 年 · ${kind==='forecast'?'你的预测':'历史财报'} FCFF：${num(value)} 亿元</strong><span>${kind==='forecast'?'这是当前输入框中的预测值，修改后曲线和这里会同步更新。':'这是历史财报形成的 FCFF；请在下方“历史现金流”核对计算口径和原始报表。'}</span>`;
}
function renderFcffChart(){
 const chart=$('fcff-chart'),fields=[...document.querySelectorAll('#forecast-fields [data-fcff-year]')];
 if(!chart||!detail)return;
 const history=(detail.company?.history||[]).filter(r=>Number.isInteger(Number(r.year))).sort((a,b)=>Number(a.year)-Number(b.year)).map(r=>({year:Number(r.year),value:r.fcff==null?null:Number(r.fcff)/1e8,kind:'history'}));
 const future=fields.map(input=>({year:Number(input.dataset.fcffYear),value:input.value.trim()===''?null:Number(input.value),kind:'forecast'}));
 const points=[...history,...future],valid=points.filter(p=>p.value!=null&&Number.isFinite(p.value));
 if(!valid.length){chart.innerHTML='<p class="small muted">填写预测金额后显示走势。</p>';return;}
 const width=Math.max(720,points.length*48+90),height=280,left=62,right=24,top=24,bottom=46;
 const rawMin=Math.min(0,...valid.map(p=>p.value)),rawMax=Math.max(0,...valid.map(p=>p.value)),span=rawMax-rawMin||1,pad=span*.12,min=rawMin-pad,max=rawMax+pad;
 const x=i=>left+(width-left-right)*(points.length===1?.5:i/(points.length-1));
 const y=v=>top+(height-top-bottom)*(max-v)/(max-min);
 const line=arr=>{let started=false;return arr.map(p=>{if(p.value==null||!Number.isFinite(p.value)){started=false;return '';}const command=`${started?'L':'M'}${x(p.index).toFixed(1)},${y(p.value).toFixed(1)}`;started=true;return command;}).join(' ');};
 const historical=history.map((p,index)=>({...p,index}));
 const projected=future.map((p,index)=>({...p,index:index+history.length}));
 const bridge=historical.length&&historical[historical.length-1].value!=null?[historical[historical.length-1],...projected]:projected;
 const ticks=[min,0,max].map(v=>`<g><line x1="${left}" y1="${y(v)}" x2="${width-right}" y2="${y(v)}" class="fcff-grid"/><text x="${left-9}" y="${y(v)+4}" text-anchor="end" class="fcff-axis">${esc(num(v,0))}</text></g>`).join('');
 const zero=`<line x1="${left}" y1="${y(0)}" x2="${width-right}" y2="${y(0)}" class="fcff-zero"/>`;
 const markers=valid.map(p=>{const i=points.indexOf(p),fill=p.kind==='history'?'#a0b4a3':'#276a52';return `<circle cx="${x(i)}" cy="${y(p.value)}" r="${p.kind==='forecast'?6:5}" fill="${fill}" stroke="white" stroke-width="2" tabindex="0" role="button" data-fcff-point data-fcff-year="${p.year}" data-fcff-kind="${p.kind}" data-fcff-value="${p.value}" aria-label="查看 ${p.year} 年${p.kind==='forecast'?'预测':'历史'} FCFF ${num(p.value)} 亿元"><title>${p.year} 年${p.kind==='forecast'?'预测':'历史'} FCFF：${esc(num(p.value,2))} 亿元；点击查看</title></circle>`;}).join('');
 const labels=points.map((p,i)=>`<text x="${x(i)}" y="${height-13}" text-anchor="middle" class="fcff-axis">${p.year}</text>`).join('');
 const divider=history.length&&future.length?`<line x1="${(x(history.length-1)+x(history.length))/2}" y1="${top}" x2="${(x(history.length-1)+x(history.length))/2}" y2="${height-bottom}" class="fcff-divider"/>`:'';
 chart.innerHTML=`<svg class="fcff-chart" viewBox="0 0 ${width} ${height}" aria-label="历史和未来 FCFF；点击或用键盘选择数据点查看数值">${ticks}${zero}${divider}<path d="${line(historical)}" class="fcff-history-line"/><path d="${line(bridge)}" class="fcff-forecast-line"/>${markers}${labels}</svg>`;
 // 最小宽度用 CSSOM 设置：行内 style 属性会被 CSP 屏蔽
 const svg=chart.querySelector('svg');if(svg)svg.style.minWidth=Math.max(560,points.length*36)+'px';
 const selected=fcffSelectedYear==null?null:chart.querySelector(`[data-fcff-year="${fcffSelectedYear}"]`);if(selected)selectFcffPoint(selected);
}
function renderValue(v){let comparison=state.rows.find(r=>r.symbol===selected)?.comparison;const r=v.result;$('value-result').innerHTML=`<div class="panel"><h3>已保存的基准情景估值 / 元每股</h3><p class="small muted">这是在所列假设下估算的每股价值，不是市场报价，也不保证股价会达到该数值。保存测算不代表已验证全部预测。</p><div class="value-number">¥${num(r.per_share)} <small>/ 股</small></div><div class="metric-line"><div><span class="small muted">企业价值 / 亿元</span><strong>${yi(r.enterprise_value)}</strong></div><div><span class="small muted">股权价值 / 亿元</span><strong>${yi(r.equity_value)}</strong></div><div><span class="small muted">终值占企业价值</span><strong>${pct(r.terminal_share)}</strong></div></div><p>${comparison?esc(comparison.reason)+' · 安全边际 '+pct(comparison.margin):'此为已保存测算；审核状态或报价未满足最终比较条件。'}</p><h3>假设敏感性</h3><p class="small muted">围绕基准 WACC ±1 个百分点、永续增长率 ±0.5 个百分点测算；这些是机械敏感性，不代表已审核的增长情景。</p><table><thead><tr><th>WACC</th><th>永续增长率</th><th>每股价值</th></tr></thead><tbody>${v.sensitivity.map(s=>`<tr><td>${pct(s.wacc)}</td><td>${pct(s.g)}</td><td>${s.per_share==null?'无效假设':'¥'+num(s.per_share)}</td></tr>`).join('')}</tbody></table><p class="small muted">保存时间：${esc(v.created_at)}</p></div>`;}
async function update(kind,code){feedback('');if(state.job.state==='running'&&['quality_scan','quality_rescan','quality_rescan_resume'].includes(state.job.kind)&&!['quality_scan','quality_rescan','quality_rescan_resume'].includes(kind)){await api('/api/pause-scan',{});feedback('正在暂停财务扫描，优先更新所选公司。');for(let n=0;n<60;n++){await new Promise(r=>setTimeout(r,1000));await load();if(state.job.state!=='running')break;}}await api('/api/update',{kind,code});await load();}
document.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.priceDays){const span=button.dataset.priceDays;renderPriceChart(span==='all'?'all':Number(span));}else if(button.dataset.klineAdjust){if(!klineAdjustAvailable())return;klineAdjust=button.dataset.klineAdjust;renderPriceChart(klineDays,klinePeriod);updatePriceAdjustLabels();}else if(button.dataset.klinePeriod){renderPriceChart(klineDays,button.dataset.klinePeriod);}else if(button.dataset.poolSort){togglePoolSort(button.dataset.poolSort);}else if(button.dataset.maToggle){toggleKlineMa(button.dataset.maToggle);}else if(button.id==='refresh-quote'){try{await update('quote',selected);}catch(err){feedback(err.message);}}});
document.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button)return;try{if(button.dataset.scenarioBasis){window.ValuationScenarios?.selectBasis(button.dataset.scenarioBasis);renderScenarios();return;}if(button.hasAttribute('data-year-order-toggle')){yearOrder=yearOrder==='desc'?'asc':'desc';window.TableTools?.clearSortIn($('research-content'));renderCompany();return;}if(button.dataset.graphMode){graphMode=button.dataset.graphMode;for(const item of document.querySelectorAll('[data-graph-mode]'))item.classList.toggle('active',item.dataset.graphMode===graphMode);renderManagementGraph(detail.management_graph);}else if(button.id==='add-forecast-year'){const container=$('forecast-fields'),count=container.querySelectorAll('[data-fcff-year]').length;if(count>=20)return;container.insertAdjacentHTML('beforeend',forecastField(Number(container.dataset.firstYear)+count,''));$('remove-forecast-year').disabled=false;button.disabled=count+1>=20;renderFcffChart();}else if(button.id==='remove-forecast-year'){const container=$('forecast-fields'),rows=container.querySelectorAll('[data-fcff-year]');if(rows.length<=1)return;rows[rows.length-1].closest('label').remove();button.disabled=rows.length-1<=1;$('add-forecast-year').disabled=false;renderFcffChart();}else if(button.id==='company-back')view(companyOrigin);else if(button.dataset.view)view(button.dataset.view);else if(button.dataset.company){companyScenarioBasis=button.dataset.forecastBasis||'median';await openCompany(button.dataset.company);}else if(button.id==='scan-quality')await update('quality_scan');else if(button.id==='rescan-quality'){if(state.quality_progress?.mode==='rescan'&&['paused','failed'].includes(state.quality_progress.state))await update('quality_rescan_resume');else if(confirm('将重新获取全部基础池公司的十年财务数据，可能耗时很久。已保存记录会逐家更新。确定开始吗？'))await update('quality_rescan');}else if(button.id==='pause-quality'){await api('/api/pause-scan',{});feedback('将在当前请求结束后暂停，已完成结果保留。');}else if(button.id==='refresh-market')await update('market');else if(button.id==='open-company')await openCompany($('company-code').value.trim());else if(button.id==='update-news')await update('news',selected);else if(button.id==='update-company-history')await update('company_history',selected);else if(button.id==='update-management-pool')await update('management_pool');else if(button.id==='update-company-history-pool')await update('company_history_pool');else if(button.id==='update-people-news-pool')await update('people_news_pool');else if(button.id==='update-financial-archive-pool')await update('financial_archive_pool');else if(button.id==='update-financial-filings-pool')await update('financial_filings_pool');else if(button.id==='update-industry-research-pool')await update('industry_research_pool');else if(button.id==='fetch-management')await update('management',selected);else if(button.id==='fetch-financial-archive')await update('financial_archive',selected);else if(button.id==='fetch-financial-filings')await update('financial_filings',selected);else if(button.id==='update-industry-research')await update('industry_research',selected);else if(button.id==='add-checklist-item')ValueReport.addCustomItem();else if(button.id==='update-people-news')await update('people_news',selected);else if(button.id==='watch-company'){await api('/api/watch',{code:selected,enabled:!detail.watching});await load();await openCompany(selected,false);feedback(detail.watching?'已加入每日资讯更新，中国时间18:30后自动处理。':'已取消每日更新。');}else if(button.id==='dcf-use-current-wacc'){const calc=window.WaccCalculator?.current?.(),input=$('dcf-form')?.querySelector('[name="wacc"]');if(calc&&input){input.value=Number(calc.wacc_pct).toFixed(4);input.dataset.waccAuto='true';feedback('已带入当前口径 WACC '+num(calc.wacc_pct)+'%，尚未保存；核对后提交本情景。');}else feedback('当前口径 WACC 还算不出来：参数未齐，请到公司页「WACC 分步计算」查看缺哪一项。');}else if(button.id==='fetch-company')await update('company',selected);else if(button.id==='fetch-disclosures')await update('disclosures',selected);}catch(err){feedback(err.message);}});
document.addEventListener('input',e=>{if(e.target.matches('#forecast-fields [data-fcff-year]'))renderFcffChart();});
document.addEventListener('input',e=>{if(e.target.name==='wacc'&&e.target.closest?.('#dcf-form'))e.target.dataset.waccAuto='false';if(e.target.closest?.('#wacc-calculator'))updateWaccFillButtons();});
document.addEventListener('click',e=>{const point=e.target.closest?.('[data-fcff-point]');if(point)selectFcffPoint(point);});
// 表格排序后同步批量测算的区间图：表与图必须同一个顺序，否则两处对不上号。
document.addEventListener('table-tools:sorted',e=>{const detail=e.detail||{};if(!detail.sync||!window.ValuationScenarios?.applyOrder)return;window.ValuationScenarios.applyOrder(detail.sync,detail.keys||[]);renderScenarios();});
document.addEventListener('click',e=>{const bar=e.target.closest?.('[data-roe-bar]'),panel=$('roe-chart-detail');if(!bar||!panel)return;for(const item of document.querySelectorAll('[data-roe-bar]'))item.classList.toggle('selected',item===bar);const value=Number(bar.dataset.roeValue),full=roeFullMean,screen=detail?.summary?.mean;panel.innerHTML=bar.dataset.roeValue===''?`<strong>${esc(bar.dataset.roeYear)} 年 ROE 缺失</strong><span>缺失值不按零计算，也不据此判断稳定性。</span>`:`<strong>${esc(bar.dataset.roeYear)} 年 ROE：${num(value)}%</strong><span>${Number.isFinite(full)?`比上市以来全期均值 ${num(full)}% ${value>=full?'高':'低'} ${num(Math.abs(value-full))} 个百分点。`:'上市以来全期均值尚未计算。'}${Number.isFinite(screen)?`近十年（筛选口径）均值 ${num(screen)}%。`:''}单年结果还需结合 ROIC、负债与现金流。</span>`;});
document.addEventListener('keydown',e=>{const point=e.target.closest?.('[data-fcff-point]');if(point&&['Enter',' '].includes(e.key)){e.preventDefault();selectFcffPoint(point);}});
document.addEventListener('change',e=>{if(e.target.id==='history-category-filter'){historyCategory=e.target.value;$('company-history-panel').outerHTML=renderCompanyHistory(detail);}});
document.addEventListener('click',e=>{if(e.target.closest('#reset-quality-policy')){const form=$('quality-policy-form');for(const [key,value] of Object.entries(state.quality_policy_defaults)){if(key==='allow_net_cash_exception')form.elements[key].checked=value;else form.elements[key].value=value;}feedback('已填入默认值；点击“保存并重新计算”后才会生效。');}});
document.addEventListener('submit',async e=>{e.preventDefault();try{const form=e.target,fd=new FormData(form);if(form.id==='quality-policy-form'){const policy={};for(const key of Object.keys(state.quality_policy_defaults))policy[key]=key==='allow_net_cash_exception'?fd.has(key):Number(fd.get(key));let paused=false;if(state.job.state==='running'&&['quality_scan','quality_rescan','quality_rescan_resume'].includes(state.job.kind)){await api('/api/pause-scan',{});paused=true;feedback('正在暂停当前扫描，随后应用新规则。');for(let n=0;n<60;n++){await new Promise(r=>setTimeout(r,1000));await load();if(state.job.state!=='running')break;}if(state.job.state==='running')throw Error('扫描尚未暂停，请稍后再次保存。');}await api('/api/quality-policy',{policy});await load();feedback(paused?'新规则已保存，正在用历史财报重算。原全量扫描已暂停，重算完成后可点“继续重新筛选”。':'规则已保存，正在用已保存的财报重算，无需重新抓取。');}else if(form.id==='review-form'){const review={decision:fd.get('decision'),reviewer:fd.get('reviewer'),reviewer_type:fd.get('reviewer_type'),risk_checked_date:fd.get('risk_checked_date'),sources:String(fd.get('sources')).split('\n').map(x=>x.trim()).filter(Boolean)};for(const [key] of reviewFields)review[key]={passed:fd.has(key+'_passed'),reason:fd.get(key+'_reason')};await api('/api/review',{code:selected,review});await load();await openCompany(selected,false);feedback('审核结论已保存。');}else if(form.id==='investment-checklist-form'){const problems=ValueReport.checklistProblems(form);if(problems.length){ValueReport.showChecklistProblems(form,problems);feedback(`还有 ${problems.length} 项没填完整，已在清单里标出并滚到第一条。`);return;}await api('/api/checklist',{code:selected,checklist:ValueReport.collectChecklist(form)});await openCompany(selected,false);feedback('逐项核查已保存；资料更新后相关问题会提示复核。');}else if(form.id==='dcf-form'){const inputs={forecasts:fd.getAll('forecast').map(x=>Number(x)*1e8),wacc:Number(fd.get('wacc'))/100,terminal_growth:Number(fd.get('terminal_growth'))/100,basis:fd.get('basis'),confirmed:fd.has('confirmed')};for(const key of ['cash','other_assets','debt','minority','other_claims','shares'])inputs[key]=Number(fd.get(key))*1e8;await api('/api/value',{code:selected,inputs});await load();await openCompany(selected,false);feedback('基准情景已保存，价格与安全边际已更新。');}}catch(err){feedback(err.message);const form=document.getElementById('investment-checklist-form');if(form&&ValueReport?.showChecklistError)ValueReport.showChecklistError(form,err.message);}});
$('search').addEventListener('input',()=>state&&renderPool());$('filter').addEventListener('change',()=>state&&renderPool());window.addEventListener('resize',()=>{priceChart?.resize();window.MarketMood?.resizeCharts();});loadMood();load().catch(e=>feedback(e.message));
