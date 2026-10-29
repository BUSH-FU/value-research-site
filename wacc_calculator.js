'use strict';

// WACC is a scenario estimate. Every input is filled from a published source when
// one exists, and left blank with a reason when it does not. Nothing is filled
// with an example number: an unsourced β, premium or borrowing cost is worse
// than an empty field, because it looks like a measurement.
window.WaccCalculator = (() => {
 const numeric = value => value === null || value === undefined || value === '' ? null : Number(value);
 const valid = (value,min,max) => value !== null && Number.isFinite(value) && value >= min && value <= max;
 // 填进输入框的数保留 4 位小数：再多位只是噪声，WACC 用不到那个精度。
 const round4 = value => value == null ? null : Math.round(value * 1e4) / 1e4;
 // 《企业所得税法》第四条：企业所得税税率为 25%。
 const STATUTORY_TAX_PCT = 25;
 function inputs(detail) {
  const rows=detail.financial_archive?.annual||[];
  const latest=[...rows].reverse().find(row=>row.indicators?.interestdebt!=null || row.income?.income_tax!=null || row.income?.total_profit!=null)||{};
  const quote=detail.quote||{};
  const close=numeric(quote.close),shares=numeric(quote.shares);
  const equity=valid(close,0.0001,1e9)&&valid(shares,1,1e15)?close*shares:null;
  const rawDebt=numeric(latest.indicators?.interestdebt);
  const debt=valid(rawDebt,0,1e15)?rawDebt:null;
  const profit=numeric(latest.income?.total_profit),taxExpense=numeric(latest.income?.income_tax);
  const effectiveTax=valid(profit,0.01,1e15)&&valid(taxExpense,0,1e15)&&taxExpense/profit<=0.5?taxExpense/profit*100:null;
  return {equity,debt,effectiveTax,riskFree:detail.risk_free_rate||{},cost:detail.cost_of_capital||{},quoteDate:quote.trade_date||'',reportYear:latest.year||'',quoteSource:quote.source||'',sharesSource:quote.shares_source||'',debtSource:latest.section_sources?.indicators||latest.disclosures?.fina_indicator?.source||'',taxSource:latest.section_sources?.income||latest.disclosures?.income?.source||''};
 }
 function calculate(data) {
  const p={};for(const key of ['equity_yi','debt_yi','risk_free_pct','beta','premium_pct','debt_cost_pct','tax_pct'])p[key]=numeric(data[key]);
  if(!valid(p.equity_yi,0.000001,1e9)||!valid(p.debt_yi,0,1e9)||!valid(p.risk_free_pct,0,30)||!valid(p.beta,0,5)||!valid(p.premium_pct,0,30)||!valid(p.debt_cost_pct,0,50)||!valid(p.tax_pct,0,50))return null;
  const total=p.equity_yi+p.debt_yi;
  if(total<=0)return null;
  const equityWeight=p.equity_yi/total,debtWeight=p.debt_yi/total;
  const equityCost=p.risk_free_pct+p.beta*p.premium_pct;
  const afterTaxDebtCost=p.debt_cost_pct*(1-p.tax_pct/100);
  const wacc=equityWeight*equityCost+debtWeight*afterTaxDebtCost;
  return {...p,equityWeight,debtWeight,equityCost,afterTaxDebtCost,wacc};
 }
 function valueInput(key,label,value,note,min,max,step='any') {
  return `<label class="field">${label}<input type="number" name="${key}" min="${min}" max="${max}" step="${step}" value="${value==null?'':esc(value)}"><small class="muted"><span data-note="${key}">${note}</span></small></label>`;
 }
 function formula() {
  return `<div class="wacc-formula"><div><strong>先算股权成本</strong><code>Re = Rf + β × (Rm − Rf)</code><p>Rf 是无风险利率；β 表示股价相对市场的波动；Rm − Rf 是股权风险溢价。</p></div><div><strong>再按资金来源加权</strong><code>WACC = E/(E+D) × Re + D/(E+D) × Rd × (1−T)</code><p>E 是股权市值，D 是有息债务的市场价值，Rd 是当前税前借款成本，T 是适用边际税率。</p></div><p class="wacc-why"><b>为什么不是“实际 WACC”？</b>股东要求的未来回报无法从财报直接读出；市场隐含股权溢价是由官方指数估值反推的当前口径，不是承诺回报，也没有官方发布的版本。本表在有公开来源时直接取该来源并标注出处，取不到就留空并写明原因，不用示例数字代替——示例数字看起来像实测值。屏幕上的百分比是按所填参数计算的<strong>估计值</strong>，不是公司披露或事后测得的唯一真实值。这里还以账面有息债务代替其市场价值、以历史有效税率代替边际税率，且股价与年报日期不同。请核实后再用于 DCF。 <a href="https://pages.stern.nyu.edu/~adamodar/New_Home_Page/definitions.html" target="_blank" rel="noopener">查看公式依据</a></p></div>`;
 }
 // ── 官方来源取值：取不到就是 null，界面上留空并说明，不代填示例 ──────────────
 function betaValue(cost){
  const beta=cost?.beta;
  if(!beta||!valid(numeric(beta.beta),0,5))return null;
  const parts=[];
  const windows=cost?.beta_windows||[];
  if(windows.length){
   parts.push(`沪深300 官方指数回归，各窗口估计：${windows.map(item=>`${esc(item.window)} β=${num(item.beta,3)}（R²=${num(item.r2,3)}，n=${item.n}）`).join('；')}`);
   parts.push('窗口之间差别很大，β 本身不稳定；表单填入的是样本最多的窗口，其余请自行比较后取用');
  }else{
   parts.push(`${esc(beta.benchmark||'沪深300')} 官方指数回归 · ${esc(beta.window||'')} · n=${beta.n} · R²=${num(beta.r2,3)} · ${esc(beta.start||'')}～${esc(beta.end||'')}`);
  }
  parts.push('个股用前复权收益率、指数用价格指数，口径不完全一致，β 相对同口径略偏低');
  if(beta.stale_note)parts.push(esc(beta.stale_note));
  return {value:round4(numeric(beta.beta)),note:parts.join('；')};
 }
 function premiumValue(cost){
  const premium=cost?.equity_premium;
  if(!premium||!valid(numeric(premium.premium_pct),0,30))return null;
  const parts=[`市场隐含口径：${esc(premium.index||'沪深300')} 官方 PE_TTM ${num(premium.pe_ttm,2)}（${esc(premium.trade_date||'')}）→ 盈利收益率 ${num(premium.earnings_yield_pct,2)}% − Rf ${num(premium.risk_free_pct,2)}% = ${num(premium.premium_pct,2)}%`];
  parts.push('由官方指数估值反推，不是官方发布的股权风险溢价，也不是承诺回报');
  if(premium.stale_note)parts.push(esc(premium.stale_note));
  return {value:round4(numeric(premium.premium_pct)),note:parts.join('；')};
 }
 function debtCostValue(cost){
  const curve=cost?.debt_cost;
  if(!curve||!curve.tenors)return null;
  const tenors=curve.tenors||{};
  const pick=['1年','3年','5年'].find(label=>valid(numeric(tenors[label]),0,50));
  if(!pick)return null;
  const list=['1年','3年','5年'].filter(label=>valid(numeric(tenors[label]),0,50)).map(label=>`${label} ${num(tenors[label],2)}%`).join(' · ');
  const parts=[`中债 AAA 中短期票据收益率曲线（${esc(curve.trade_date||'')}）：${list}；此处取 ${pick}。这是市场同类无风险信用债收益率，不等于这家公司的实际融资利率`];
  if(curve.stale_note)parts.push(esc(curve.stale_note));
  return {value:round4(numeric(tenors[pick])),note:parts.join('；')};
 }
 function taxNote(source){
  const effective=source.effectiveTax==null?null:numeric(source.effectiveTax);
  const parts=[];
  parts.push(effective==null?'年报有效税率未取得；请核实边际税率':`年报有效税率 ${num(effective)}%（所得税÷利润总额），仅作边际税率代理；${esc(source.taxSource||'来源待取')}`);
  parts.push(`法定税率 ${STATUTORY_TAX_PCT}%（《企业所得税法》第四条）`);
  return parts.join('；');
 }
 function render(detail) {
  const source=inputs(detail),code=detail.stock?.symbol||'';
  const saved=detail.wacc_assumption?.components;
  const same=saved?.quote_date===source.quoteDate&&Number(saved?.report_year)===Number(source.reportYear);
  // 已保存的同口径情景优先；否则用官方来源；官方来源也没有就留空，绝不代填示例值。
  const official={beta:betaValue(source.cost),premium:premiumValue(source.cost),debtCost:debtCostValue(source.cost)};
  const assumptions=same?saved:{beta:official.beta?.value??null,premium_pct:official.premium?.value??null,debt_cost_pct:official.debtCost?.value??null};
  const equity=same?saved.equity_yi:source.equity==null?null:source.equity/1e8,debt=same?saved.debt_yi:source.debt==null?null:source.debt/1e8;
  // 年报有效税率是除法结果，位数很长；填进输入框保留 2 位小数即可，来源说明里已经写清 25.66%。
  const tax=assumptions.tax_pct??(source.effectiveTax==null?null:Math.round(source.effectiveTax*100)/100);
  const riskFree=source.riskFree.status==='available'?numeric(source.riskFree.rate_pct):null;
  const riskNote=riskFree===null?'正在查询中债 10 年期国债收益率；未取得前不代填数值':`中债 10 年期国债收益率 · 发布日 ${esc(source.riskFree.published_date)} · ${esc(riskFree)}%`;
  const beta=assumptions.beta??null,premium=assumptions.premium_pct??null,debtCost=assumptions.debt_cost_pct??null;
  const betaNote=(same&&official.beta?'你保存的 β；官方来源同口径参考：'+official.beta.note:(official.beta?official.beta.note:'未取得：需要个股与沪深300 的日行情做回归，尚未成功；请手动填入并注明来源'))+'　你可以直接改写成某个行情软件或数据商公布的 β；改过的这一格会被保留、不被自动值覆盖，但请写明来源与回归窗口（不同窗口差很多）。';
  const premiumNote=same&&official.premium?'你保存的股权溢价；官方来源同口径参考：'+official.premium.note:(official.premium?official.premium.note:'未取得：需要官方指数估值与无风险利率，尚未成功；请手动填入并注明来源');
  const debtNote=same&&official.debtCost?'你保存的债务成本；官方来源同口径参考：'+official.debtCost.note:(official.debtCost?official.debtCost.note:'未取得：需要中债信用债收益率曲线，尚未成功；请手动填入并注明来源');
  const initial=calculate({equity_yi:equity,debt_yi:debt,risk_free_pct:riskFree,beta,premium_pct:premium,debt_cost_pct:debtCost,tax_pct:tax});
  return `<section class="wacc-calculator" id="wacc-calculator" data-code="${esc(code)}" data-quote-date="${esc(source.quoteDate)}" data-report-year="${esc(source.reportYear)}"><div class="section-head"><div><h4>WACC 分步计算 <span class="pill warning">研究情景</span></h4><p class="small muted">有公开来源的参数直接取该来源并标注出处：国债收益率取中债，β 由沪深300 官方指数回归，债务成本取中债信用债曲线，税率取年报。取不到的参数留空并写明原因，不代填示例数字。这是**当前时点**口径（参数取最近一个交易日），用于正式 DCF；与上方「最新年计算 WACC」（当年口径）不是同一个数，主要差别在 β 回归窗口的截止日与市场参数日期。</p></div><output class="wacc-result" id="wacc-result" aria-live="polite">${initial?num(initial.wacc)+'%':'待补输入'}</output></div>${formula()}<div class="wacc-calculator-grid">${valueInput('equity_yi','股权市值 E（亿元）',equity,'收盘价 '+esc(source.quoteDate||'待取')+' × 当日总股本；'+esc(source.quoteSource||'来源待取')+' / '+esc(source.sharesSource||'股本待取'),0,1e9)}${valueInput('debt_yi','有息债务 D（亿元）',debt,esc(source.reportYear||'待取')+' 年年报财务指标 interestdebt（有息负债，含借款、应付债券、租赁负债等有息项）；'+esc(source.debtSource||'来源待取')+'。账面值仅作市场债务价值代理；缺失不按零。',0,1e9)}${valueInput('risk_free_pct','无风险利率参考 Rf（%）',riskFree,`<span data-risk-free-note>${riskNote}</span> · <a href="https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/more?locale=cn_zh" target="_blank" rel="noopener">查看中债原始数据</a>`,0,30)}${valueInput('beta','β 系数',beta,betaNote+' · <a href="https://www.csindex.com.cn/#/indices/family/detail?indexCode=000300" target="_blank" rel="noopener">查看中证指数</a>',0,5)}${valueInput('premium_pct','股权风险溢价（%）',premium,premiumNote,0,30)}${valueInput('debt_cost_pct','税前债务成本（%）',debtCost,debtNote+' · <a href="https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/more?locale=cn_zh" target="_blank" rel="noopener">查看中债原始数据</a>',0,50)}${valueInput('tax_pct','适用边际税率 T（%）',tax,taxNote(source),0,50)}</div><div id="wacc-steps" class="wacc-steps">${steps(initial)}</div><div class="wacc-actions"><button type="button" id="wacc-use-result" ${initial?'':'disabled'}>将计算值填入研究假设</button><span class="small muted">测算结果不会自动改动已保存的 WACC 或 DCF；核实参数后再保存。</span></div></section>`;
 }
 function steps(r) {
  if(!r)return '<p class="small muted">尚缺股权市值、有息债务或必要参数，暂不能计算。补齐后立即显示结果。</p>';
  return `<div><b>① 股权成本</b><span>${num(r.risk_free_pct)}% ＋ ${num(r.beta)} × ${num(r.premium_pct)}% = <strong>${num(r.equityCost)}%</strong></span></div><div><b>② 税后债务成本</b><span>${num(r.debt_cost_pct)}% ×（1 − ${num(r.tax_pct)}%）= <strong>${num(r.afterTaxDebtCost)}%</strong></span></div><div><b>③ 资金权重</b><span>股权 ${num(r.equity_yi)} ÷（${num(r.equity_yi)} ＋ ${num(r.debt_yi)}）= <strong>${num(r.equityWeight*100)}%</strong>；债务 <strong>${num(r.debtWeight*100)}%</strong></span></div><div><b>④ 加权结果</b><span>${num(r.equityCost)}% × ${num(r.equityWeight*100)}% ＋ ${num(r.afterTaxDebtCost)}% × ${num(r.debtWeight*100)}% = <strong>${num(r.wacc)}%</strong></span></div>`;
 }
 function formData(form) {const data={};for(const name of ['equity_yi','debt_yi','risk_free_pct','beta','premium_pct','debt_cost_pct','tax_pct'])data[name]=form.querySelector(`[name="${name}"]`)?.value;return data;}
 function refresh(form) {const result=calculate(formData(form));form.querySelector('#wacc-result').textContent=result?num(result.wacc)+'%':'待补输入';form.querySelector('#wacc-steps').innerHTML=steps(result);form.querySelector('#wacc-use-result').disabled=!result;window.ValueReport?.renderCurrentWaccLine?.();return result;}
 document.addEventListener('input',event=>{const form=event.target.closest?.('#wacc-calculator');if(form){if(event.target.name==='risk_free_pct')event.target.dataset.userEdited='1';if(['beta','premium_pct','debt_cost_pct'].includes(event.target.name))event.target.dataset.userEdited='1';refresh(form);}});
 document.addEventListener('click',event=>{if(event.target.id!=='wacc-use-result')return;const form=event.target.closest('#wacc-calculator'),result=refresh(form),research=document.getElementById('wacc-research-form');if(!result||!research)return;research.elements.wacc_pct.value=result.wacc.toFixed(4);research.elements.basis.value=`CAPM 情景：Rf ${result.risk_free_pct}%、β ${result.beta}、股权溢价 ${result.premium_pct}%、税前借款成本 ${result.debt_cost_pct}%、税率 ${result.tax_pct}%；股权市值 ${result.equity_yi} 亿元、有息债务 ${result.debt_yi} 亿元；行情 ${form.dataset.quoteDate}，财报 ${form.dataset.reportYear}。β、股权溢价与借款成本的来源见上方 WACC 分步计算的标注，请核实后再作为研究假设保存。`;research.scrollIntoView({behavior:'smooth',block:'center'});});
 function current() {const form=document.getElementById('wacc-calculator');if(!form)return null;const result=calculate(formData(form));return result?{equity_yi:result.equity_yi,debt_yi:result.debt_yi,risk_free_pct:result.risk_free_pct,beta:result.beta,premium_pct:result.premium_pct,debt_cost_pct:result.debt_cost_pct,tax_pct:result.tax_pct,quote_date:form.dataset.quoteDate,report_year:Number(form.dataset.reportYear),wacc_pct:result.wacc}:null;}
 function applyRiskFree(rate) {const form=document.getElementById('wacc-calculator');if(!form)return;const input=form.querySelector('[name="risk_free_pct"]'),note=form.querySelector('[data-risk-free-note]');if(!input||!note)return;if(rate?.status==='available'&&valid(numeric(rate.rate_pct),0,30)){note.textContent=`中债 10 年期国债收益率 · 发布日 ${rate.published_date} · ${rate.rate_pct}%`;if(input.dataset.userEdited!=='1'){input.value=rate.rate_pct;refresh(form);}}else{note.textContent='公开收益率暂未取得；请稍后重试或查中债原始数据。';if(input.dataset.userEdited!=='1'){input.value='';refresh(form);}}}
 // β、市场隐含股权溢价、税前债务成本：拿到官方来源后回填，用户手改过的不覆盖。
 function applyCostOfCapital(block){
  const form=document.getElementById('wacc-calculator');if(!form||!block)return;
  const fill=(name,value,note)=>{
   const input=form.querySelector(`[name="${name}"]`),target=form.querySelector(`[data-note="${name}"]`);
   if(!input)return;
   if(note&&target&&!target.dataset.locked)target.innerHTML=note;
   if(input.dataset.userEdited==='1')return;
   input.value=value==null?'':value;
  };
  const beta=betaValue(block),premium=premiumValue(block),debtCost=debtCostValue(block);
  if(beta){fill('beta',beta.value,beta.note+' · <a href="https://www.csindex.com.cn/#/indices/family/detail?indexCode=000300" target="_blank" rel="noopener">查看中证指数</a>');}
  if(premium)fill('premium_pct',premium.value,premium.note);
  if(debtCost)fill('debt_cost_pct',debtCost.value,debtCost.note+' · <a href="https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/more?locale=cn_zh" target="_blank" rel="noopener">查看中债原始数据</a>');
  refresh(form);
  window.ValueReport?.renderCurrentWaccLine?.();
 }
 return {render,calculate,inputs,current,applyRiskFree,applyCostOfCapital,betaValue,premiumValue,debtCostValue};
})();
