'use strict';

// 公司研究档案的展示层。数字只取已保存的财报和有来源的待核研究草稿。
window.ValueReport = (() => {
 const chartInstances = [];
 const labels = {
  total_revenue:'营业总收入', revenue:'营业收入', total_cogs:'营业总成本', oper_cost:'营业成本',
  sell_exp:'销售费用', admin_exp:'管理费用', fin_exp:'财务费用', operate_profit:'营业利润',
  total_profit:'利润总额', income_tax:'所得税', n_income:'合并净利润', n_income_attr_p:'归母净利润', basic_eps:'基本每股收益',
  ebit:'息税前利润', ebitda:'息税折旧摊销前利润', total_share:'期末总股本', money_cap:'货币资金',
  trad_asset:'交易性金融资产', accounts_receiv:'应收账款', notes_receiv:'应收票据', inventories:'存货',
  total_cur_assets:'流动资产', fix_assets:'固定资产', goodwill:'商誉', intan_assets:'无形资产',
  total_assets:'总资产', st_borr:'短期借款', lt_borr:'长期借款', bond_payable:'应付债券',
  non_cur_liab_due_1y:'一年内到期长期负债', lease_liab:'租赁负债', acct_payable:'应付账款',
  notes_payable:'应付票据', adv_receipts:'预收款', contract_liab:'合同负债',
  total_cur_liab:'流动负债', total_liab:'总负债', minority_int:'少数股东权益',
  total_hldr_eqy_exc_min_int:'归母净资产', total_hldr_eqy_inc_min_int:'股东权益合计',
  oth_eqt_tools_p_shr:'优先股', oth_eq_ppbond:'永续债', c_fr_sale_sg:'销售收现',
  n_cashflow_act:'经营现金流净额', n_cashflow_inv_act:'投资现金流净额',
  n_cash_flows_fnc_act:'筹资现金流净额', c_pay_acq_const_fiolta:'资本开支现金支出',
  free_cashflow:'供应商自由现金流', eps:'每股收益', bps:'每股净资产',
  roe_waa:'加权平均 ROE', roe_dt:'扣非 ROE', roic:'投入资本回报率', profit_dedt:'扣非净利润',
  grossprofit_margin:'毛利率', netprofit_margin:'净利率', ocf_to_or:'经营现金流/收入',
  debt_to_assets:'资产负债率', netdebt:'净债务', interestdebt:'有息债务',
  book_value_attributable:'归母账面净资产', book_value_per_share:'每股账面净资产',
  vendor_book_value_per_share:'供应商每股净资产', liabilities_to_assets_pct:'负债/资产',
  current_ratio:'流动比率', operating_cash_flow_less_capex:'经营现金流−资本开支',
  cash_flow_to_net_income:'经营现金流/归母净利润', gross_margin_pct:'毛利率',
  roe_pct:'ROE', roic_pct:'ROIC'
 };
 const ratioFields = new Set(['roe_waa','roe_dt','roic','grossprofit_margin','netprofit_margin','ocf_to_or','debt_to_assets','liabilities_to_assets_pct','gross_margin_pct','roe_pct','roic_pct']);
 const perShareFields = new Set(['basic_eps','eps','bps','book_value_per_share','vendor_book_value_per_share']);
 const multipleFields = new Set(['current_ratio','cash_flow_to_net_income','cash_profit_ratio']);
 const categoryName = {income:'利润表',balance_sheet:'资产负债表',cash_flow:'现金流量表',indicators:'财务指标',derived:'研究计算'};
 const moatName = {brand:'品牌',cost:'成本',license:'牌照',technology:'技术',network:'网络',switching:'转换成本',scale:'规模',distribution:'渠道',other:'其他'};
 const overviewMetrics = {
  revenue:{title:'收入',meaning:'这一年卖产品、提供服务确认的营业收入，还没扣成本，也不等于已经收到的现金。',caution:'收入增加说明生意规模可能扩大，但要同时看利润和经营现金流。'},
  n_income_attr_p:{title:'归母净利润',meaning:'一年结算后，按会计规则归属于母公司股东的利润。',caution:'它是账面利润；赊销、一次性收益等会让利润和收到的现金不同。'},
  n_cashflow_act:{title:'经营现金流',meaning:'公司日常生意带来的现金净流入；已经考虑经营中的收款和付款。',caution:'单年可能受回款、库存和付款时间影响，应连着多年看，也要核对现金是否受限。'},
  n_income:{title:'合并净利润',meaning:'合并报表中整个集团这一年的净利润，含少数股东享有的部分；和合并口径的经营现金流对照更合适。',caution:'合并净利润仍是会计利润，不等于收到的现金。旧档案缺此字段时保持空白，更新年度财务后才可能补齐。'},
  cash_profit_ratio:{title:'现金/利润',meaning:'经营现金流除以净利润，粗看账面利润转成经营现金的程度。',caution:'0.8 和 1.2 只是帮助阅读的观察线，不是买卖标准；单年波动可能来自存货、预付、税费、应收应付及非现金项目。合并利润缺失而使用归母利润时口径不完全一致。'},
  cash_profit_gap:{title:'现金－利润',meaning:'经营现金流减净利润：负数代表当年经营现金净流入低于账面利润。',caution:'这个差额不能称为“欠条”或“未收回的钱”；还要核对存货、预付款、应付、税费和折旧等项目。合并利润缺失时用归母利润作参考，口径不完全一致。'},
  accounts_receiv:{title:'应收账款余额',meaning:'资产负债表日客户等尚欠公司的货款账面余额，是回款研究的线索。',caution:'包含此前年度的未结款项，也可能有坏账准备；不等于本年利润中未收回的现金，更不等于全部都能收回。'},
  accounts_receiv_change:{title:'应收账款增减',meaning:'本年末应收账款减去上年末应收账款；正数说明这项账面余额比去年多。',caution:'余额变化不能单独解释经营现金流与利润的差额；还需核对票据、合同资产、应收款项融资、减值和附注。'},
  cash_profit_reading:{title:'现金与利润解读',meaning:'把同年经营现金流与净利润放在一起看，指出值得查证的方向。',caution:'仅是阅读线索，不能据此直接断定赊销、造假或投资价值；金融公司还需使用行业报表口径。'},
  total_assets:{title:'总资产',meaning:'年末资产负债表上公司掌握或控制的资产总账面额。',caution:'里面可能有应收账款、存货、商誉；账面金额不等于现在卖掉能拿到的钱。'},
  total_liab:{title:'总负债',meaning:'年末公司承担的全部会计负债，包括借款、应付供应商的款项等。',caution:'总负债不全是要付利息的贷款；需要再分辨有息债务与经营性应付款。'},
  book_value_attributable:{title:'归母净资产',meaning:'年末账面资产扣掉负债，再扣除不属于母公司股东的权益，剩下归属于母公司股东的账面家底。',caution:'它不是清算可收回金额，也不是公司的内在价值。'},
  total_share:{title:'总股本',meaning:'这一年年报时点公司已发行的股份总数，每股账面价值就是用它分摊出来的。',caution:'股本会因增发、回购、送转、股权激励而变动；不同年份的每股数不能直接横向比较，年报期末股本也不等于今天行情日的股本。'},
  book_value_per_share:{title:'每股账面价值',meaning:'把归母净资产按年报期末总股本分摊到每一股。',caution:'这里是年报时点的账面数，不是当前可卖价；股本变化或资产减值会改变可比性。'},
  market_bvps:{title:'每股账面价值 · 行情日股本口径',meaning:'把最近已披露年报的归母净资产，用行情日已核对的总股本重新分摊到每一股，以便和当日股价比较。',caution:'分子仍是旧年报时点的净资产，年报之后的资产负债变化尚未反映；这不是内在价值。'},
  price_to_book:{title:'市净率 P/B',meaning:'当前每股收盘价相当于每股账面净资产的多少倍。',caution:'市净率低不一定便宜；要检查账面资产质量、盈利能力和年报之后的变化。'},
  roe_pct:{title:'ROE · 加权平均净资产收益率',meaning:'股东投入企业的账面资本，在这一年产生了多少会计利润。',caution:'借很多钱也可能抬高 ROE；要结合负债、ROIC 和多年稳定性看。'},
  roic_pct:{title:'ROIC · 投入资本回报率',meaning:'观察企业运用股东和债权人投入的资本，取得经营回报的效率。',caution:'不同数据源的税后经营利润和投入资本口径可能不同；本表保留供应商原值，不假装用简化公式复算。'},
  roe_roic_gap_pct:{title:'ROE－ROIC',meaning:'把股东账面资本回报与整个业务投入资本回报相减，先看两者差多少个百分点。',caution:'差额不是负债率，也不能单独证明企业借债推高了 ROE；还可能涉及非经营资产、少数股东权益和两个指标的数据口径。'},
  roe_roic_reading:{title:'ROE / ROIC 对照',meaning:'把同一年度 ROE 和 ROIC 放在一起，直接给出两者关系及下一步应核查的方向。',caution:'接近不等于没有债务；ROE 高于 ROIC 也不等于一定靠借债获利。2、5 个百分点是阅读提示线，不是筛选条件或跨行业标准。'},
  wacc_pct:{title:'DCF 折现率假设',meaning:'你为这家公司估计的面向未来的资金成本，也是 DCF 里折现未来现金流的贴现率。历史各年的资金成本由逐年计算给出，不用这一格回看历史。',caution:'WACC 不是财报披露的年度业绩，也不是股东买入股票后的实际收益率；这一格面向未来，不会改写历史各年的资金成本。'},
  roic_spread_pct:{title:'ROIC － 当年 WACC',meaning:'用这一年的 ROIC 减去这一年的 WACC，观察当年投入资本回报是否高于当年的资金成本。',caution:'正差额只表示按当年口径测算有经济回报空间；WACC 本身是研究者按公开数据推算的估计值，股权风险溢价由官方指数估值反推、市场估值极高的年份会失真；单年结果不能直接证明长期创造价值。'},
  wacc_year_pct:{title:'当年 WACC',meaning:'这一年的资金成本：按这一年的无风险利率、股权风险溢价、β、股权市值权重、税前债务成本和有效税率算出来。',caution:'WACC 没有任何官方发布的版本，它是按公开数据推算的估计值；股权风险溢价由沪深300 官方估值反推，不是官方发布的数；股权市值用当年年末收盘价，账面有息负债代替债务市场价值。'},
  roic_reading:{title:'ROIC / WACC 解读',meaning:'把实际披露的年度 ROIC 放进示意观察区间，看清每一段代表什么含义，再与已确认的 WACC 假设比较。',caution:'8%、12%、20% 是阅读用的示意分段，不是跨行业的统一合格线；分段含义只帮助定位读法，不参与自动筛选；金融企业尤其不能直接套普通企业口径。'}
 };
 const metricSections = {revenue:'income',n_income_attr_p:'income',n_income:'income',n_cashflow_act:'cash_flow',cash_profit_ratio:'cash_flow',cash_profit_gap:'cash_flow',cash_profit_reading:'cash_flow',accounts_receiv:'balance_sheet',accounts_receiv_change:'balance_sheet',total_assets:'balance_sheet',total_liab:'balance_sheet',book_value_attributable:'balance_sheet',book_value_per_share:'balance_sheet',total_share:'balance_sheet',market_bvps:'balance_sheet',price_to_book:'balance_sheet',roe_pct:'indicators',roic_pct:'indicators',roe_roic_gap_pct:'indicators',roe_roic_reading:'indicators',wacc_pct:'assumption',wacc_year_pct:'assumption',roic_spread_pct:'assumption',roic_reading:'assumption'};
 const disclosureSections = {income:'income',cash_flow:'cashflow',balance_sheet:'balancesheet',indicators:'fina_indicator'};
 function profitBasis(row){const consolidated=row.income?.n_income,attributable=row.income?.n_income_attr_p;return consolidated!=null?{value:consolidated,label:'合并净利润',exact:true}:attributable!=null?{value:attributable,label:'归母净利润',exact:false}:{value:null,label:'净利润',exact:false};}
 function previousAnnual(archive,row){return (archive?.annual||[]).find(item=>Number(item.year)===Number(row.year)-1);}
 function cashReading(row){const cash=row.cash_flow?.n_cashflow_act,profit=profitBasis(row);if(cash==null||profit.value==null)return '数据不足';if(!profit.exact)return cash<profit.value?'现金低于归母利润 · 口径参考':'现金高于归母利润 · 口径参考';if(profit.value<=0)return '利润非正，查原因';if(cash<0)return '现金净流出，重点核对';const ratio=cash/profit.value;return ratio<0.8?'现金明显低于利润':ratio<=1.2?'现金与利润接近':'现金高于利润';}
 // 资本回报示意带：把 ROIC 示意分段和当前标的画在同一百分比轴上；研究者自己保存的 WACC 假设单独标出。
// 分段只用于阅读定位，不是筛选条件，也不是跨行业合格线。
// range 写区间位置，meaning 写这一段到底代表什么含义；含义要直接显示在界面上，不能只藏在悬停提示里。
// 这里不画写死的资金成本区间：固定区间不是这家公司的数，画在真实数据同一根轴上会被误读成实测值。
// WACC 只在研究者实际保存了假设时才出现，位置就是那个假设本身。
const ROIC_ZONES=[
 {from:0,to:8,range:'低于 8%',label:'低于 8% 示意线',meaning:'回报低于常见资金成本',short:'<8%',color:'#eef0e8',text:'#6b756a',test:value=>value>=0&&value<8},
 {from:8,to:12,range:'8%～12%',label:'8%～12% 示意区',meaning:'大致覆盖资金成本',short:'8–12%',color:'#e7eddf',text:'#5b6b52',test:value=>value>=8&&value<12},
 {from:12,to:20,range:'12%～20%',label:'12%～20% 示意区',meaning:'明显高于资金成本',short:'12–20%',color:'#dce9d7',text:'#44684a',test:value=>value>=12&&value<=20},
 {from:20,to:null,range:'高于 20%',label:'高于 20% 示意线',meaning:'回报很强，须核对是否在周期高点',short:'>20%',color:'#cfe5c8',text:'#2b7657',test:value=>value>20}];
const ROIC_NEGATIVE_ZONE={range:'负回报',label:'负回报 · 查原因',meaning:'投入资本在亏钱，须先查原因',short:'<0%',color:'#f3e4e1',text:'#a35a4b'};
function roicZone(value){if(value==null)return 'ROIC 待补';if(value<0)return ROIC_NEGATIVE_ZONE.label;const zone=ROIC_ZONES.find(item=>item.test(value));return zone?zone.label:'ROIC 待补';}
function roicZoneMeaning(value){if(value==null)return null;if(value<0)return ROIC_NEGATIVE_ZONE.meaning;const zone=ROIC_ZONES.find(item=>item.test(value));return zone?zone.meaning:null;}
function roicZoneMeaningList(){return ROIC_ZONES.map(zone=>`${zone.range}＝${zone.meaning}`).join('；')+'；负回报＝'+ROIC_NEGATIVE_ZONE.meaning+'。';}
 function roicReading(row){const roic=row.derived?.roic_pct;if(roic==null)return 'ROIC 待补';const yearWaccValue=yearWacc(row)?.wacc_pct;if(yearWaccValue==null)return `${roicZone(roic)} · 当年 WACC 待算`;const spread=roic-yearWaccValue;return `${roicZone(roic)} · ${spread>0.01?'高于':spread< -0.01?'低于':'约等于'} WACC`;}
 function roeRoicGap(row){const roe=row.derived?.roe_pct,roic=row.derived?.roic_pct;return Number.isFinite(roe)&&Number.isFinite(roic)?roe-roic:null;}
 function roeRoicReading(row){const gap=roeRoicGap(row);if(gap==null)return '缺一项，暂不对照';if(Math.abs(gap)<=2)return '两项接近 · 核对债务';if(gap>5)return 'ROE 明显较高 · 查杠杆';if(gap>0)return 'ROE 较高 · 查原因';if(gap< -5)return 'ROIC 明显较高 · 查口径';return 'ROIC 较高 · 查原因';}
 const metricValues = {revenue:r=>r.income?.total_revenue??r.income?.revenue,n_income_attr_p:r=>r.income?.n_income_attr_p,n_income:r=>r.income?.n_income,n_cashflow_act:r=>r.cash_flow?.n_cashflow_act,cash_profit_ratio:r=>{const p=profitBasis(r).value,c=r.cash_flow?.n_cashflow_act;return p>0&&c!=null?c/p:null;},cash_profit_gap:r=>{const p=profitBasis(r).value,c=r.cash_flow?.n_cashflow_act;return p!=null&&c!=null?c-p:null;},accounts_receiv:r=>r.balance_sheet?.accounts_receiv,accounts_receiv_change:(r,a)=>{const p=previousAnnual(a,r)?.balance_sheet?.accounts_receiv,c=r.balance_sheet?.accounts_receiv;return p!=null&&c!=null?c-p:null;},cash_profit_reading:r=>cashReading(r),total_assets:r=>r.balance_sheet?.total_assets,total_liab:r=>r.balance_sheet?.total_liab,book_value_attributable:r=>r.derived?.book_value_attributable,book_value_per_share:r=>r.derived?.book_value_per_share,total_share:r=>r.balance_sheet?.total_share,roe_pct:r=>r.derived?.roe_pct,roic_pct:r=>r.derived?.roic_pct,roe_roic_gap_pct:r=>roeRoicGap(r),roe_roic_reading:r=>roeRoicReading(r),wacc_pct:()=>activeWacc==null?null:activeWacc*100,wacc_year_pct:r=>yearWacc(r)?.wacc_pct??null,roic_spread_pct:r=>yearWacc(r)?.spread_pct??null,roic_reading:r=>roicReading(r)};
 let activeArchive=null,activeQuote=null,activeWacc=null,activeValuation=null,activeWaccSource=null,activeWaccSavedAt=null,activeWaccBasis=null,activeCapitalModel=null,activeWaccHistory=null;
// 最新年按当年公开数据算出的 WACC：历史回看用它；面向未来的折现率用 activeWacc。两者不是一回事。
let activeYearWacc=null,activeLatestYear=null;
 // 逐年 WACC：每一年的资金成本都按那一年的市场数据算，不能用今天的一个数套历史。
 function yearWacc(row){const item=activeWaccHistory?.get(Number(row?.year));return item||null;}
 function fieldValue(key,value){if(value==null)return '—';if(key==='total_share')return num(value/1e8,4)+' 亿股';if(['roic_spread_pct','roe_roic_gap_pct'].includes(key))return (value>=0?'+':'')+num(value)+' 个百分点';if(ratioFields.has(key)||key==='wacc_pct'||key==='wacc_year_pct')return num(value)+'%';if(perShareFields.has(key)||key==='market_bvps')return '¥'+num(value,4);if(multipleFields.has(key)||key==='price_to_book')return num(value,3)+' 倍';return yi(value)+' 亿';}
 function metricButton(row,key){const value=metricValues[key](row,activeArchive),reading=['cash_profit_reading','roe_roic_reading','roic_reading'].includes(key),label=reading?esc(value):fieldValue(key,value),basisNote=['cash_profit_ratio','cash_profit_gap'].includes(key)&&value!=null&&!profitBasis(row).exact?'<small class="basis-note">归母参考</small>':key==='wacc_pct'&&value!=null?'<small class="basis-note">当前情景 · 非当年实测</small>':key==='wacc_year_pct'&&value!=null?'<small class="basis-note">按当年数据推算</small>':'';return `<button type="button" class="metric-value-button${reading?' reading-badge':''}" data-financial-metric="${key}" data-financial-year="${row.year}" aria-label="查看 ${row.year} 年${overviewMetrics[key].title}的含义和计算过程">${label}${basisNote}</button>`;}
 function metricHeader(key){return `<button type="button" class="metric-head-button" data-financial-metric="${key}" aria-label="了解${overviewMetrics[key].title}">${overviewMetrics[key].title}<span aria-hidden="true"> ⓘ</span></button>`;}
 function metricMoney(value){return value==null?'尚未取得':num(value/1e8,4)+' 亿元';}
 function explainFinancialMetric(archive,year,key,quote=null){
  const info=overviewMetrics[key],row=(archive?.annual||[]).find(item=>String(item.year)===String(year));
  if(!info||!row)return '<p>这项数据暂时无法定位到年度财报。</p>';
  const comparison=archive.latest_book_to_price||{};
  const value=key==='market_bvps'?comparison.book_value_per_share:key==='price_to_book'?comparison.price_to_book:metricValues[key](row,archive);
  const balance=row.balance_sheet||{},income=row.income||{};
  const section=metricSections[key],disclosure=row.disclosures?.[section==='assumption'?'fina_indicator':disclosureSections[section]]||{};
  const source=row.section_sources?.[section]||disclosure.source||'来源未记录';
  const steps=[];
  if(key==='revenue')steps.push(`打开 ${year} 年利润表，读取${income.total_revenue!=null?'营业总收入（total_revenue）':'营业收入（revenue）'}：${metricMoney(value)}。本表直接展示披露值，没有另做利润计算。`);
  if(key==='n_income_attr_p')steps.push(`打开 ${year} 年利润表，读取归属于母公司股东的净利润：${metricMoney(value)}。具体收入、成本、税费及少数股东损益在利润表中逐项形成。`);
  if(key==='n_cashflow_act')steps.push(`打开 ${year} 年现金流量表，读取经营活动现金流量净额：${metricMoney(value)}。经营现金流入减经营现金流出由公司财报列示。`);
  if(key==='n_income')steps.push(`打开 ${year} 年合并利润表，读取净利润（n_income）：${metricMoney(value)}。它包括归母净利润和少数股东损益，不要与归母净利润混为一谈。`);
  if(['cash_profit_ratio','cash_profit_gap','cash_profit_reading'].includes(key)){
   const cash=row.cash_flow?.n_cashflow_act,profit=profitBasis(row);
   steps.push(`先取 ${year} 年合并现金流量表经营现金流：${metricMoney(cash)}；再取利润表${profit.label}：${metricMoney(profit.value)}。${profit.exact?'两项都按合并报表口径展示。':'缺少合并净利润，暂用归母净利润对照，口径并不完全一致，只能作为待核线索。'}`);
   steps.push(cash!=null&&profit.value!=null?`相减：${metricMoney(cash)} − ${metricMoney(profit.value)} = ${metricMoney(cash-profit.value)}。这只是现金与利润的差额，不能直接解释成未收货款。`:'缺少现金流或利润，不能计算差额；空白不当作零。');
   if(profit.value>0&&cash!=null)steps.push(`相除：${metricMoney(cash)} ÷ ${metricMoney(profit.value)} = ${num(cash/profit.value,3)} 倍。${profit.exact?'用于观察当年利润的现金转化。':'由于净利润口径不同，不按区间给这家公司下结论。'}`);
   else steps.push('净利润为零、负数或缺失时，现金/利润倍数不具有通常的现金转化含义，表格留空。');
   const ar=row.balance_sheet?.accounts_receiv,prior=previousAnnual(archive,row)?.balance_sheet?.accounts_receiv;
   steps.push(`回款线索：本年末应收账款 ${metricMoney(ar)}；上年末 ${metricMoney(prior)}${ar!=null&&prior!=null?`；增减 ${metricMoney(ar-prior)}`:''}。应收账款只是若干营运资金项目之一，不能用它直接解释上面的差额。`);
  }
  if(key==='accounts_receiv')steps.push(`读取 ${year} 年资产负债表“应收账款”：${metricMoney(value)}。这是报告日余额，历史欠款可能仍在其中；具体账龄、坏账准备要查年报附注。`);
  if(key==='accounts_receiv_change'){
   const previous=previousAnnual(archive,row)?.balance_sheet?.accounts_receiv;
   steps.push(`取 ${year} 年末应收账款 ${metricMoney(balance.accounts_receiv)}，减去 ${Number(year)-1} 年末 ${metricMoney(previous)}。`);
   steps.push(value==null?'缺任一年余额，无法比较；不能把空值当零。':`计算：${metricMoney(balance.accounts_receiv)} − ${metricMoney(previous)} = ${metricMoney(value)}。正数是余额增加，负数是余额减少。`);
  }
  if(key==='total_assets')steps.push(`打开 ${year} 年资产负债表，读取资产总计：${metricMoney(value)}。它是各类资产的账面合计。`);
  if(key==='total_liab')steps.push(`打开 ${year} 年资产负债表，读取负债合计：${metricMoney(value)}。它包括借款和经营性应付款。`);
  if(key==='book_value_attributable'){
   steps.push(`读取 ${year} 年资产负债表中的归属于母公司股东权益合计：${metricMoney(value)}。这是报表原值。`);
   const assets=balance.total_assets,liabilities=balance.total_liab,minority=balance.minority_int;
   if(assets!=null&&liabilities!=null&&minority!=null)steps.push(`另做勾稽核对：总资产 ${metricMoney(assets)} − 总负债 ${metricMoney(liabilities)} − 少数股东权益 ${metricMoney(minority)} ≈ ${metricMoney(assets-liabilities-minority)}。如与报表原值不同，需核对其他权益项目及年报原文。`);
  }
  if(key==='total_share'){
   const shares=balance.total_share;
   steps.push(`打开 ${year} 年资产负债表，读取期末总股本（total_share）：${shares==null?'尚未取得':num(shares/1e8,4)+' 亿股'}。报表原值单位是股。`);
   steps.push(`这一栏直接给出分母，所以归母净资产 ÷ 总股本 = 每股账面价值，可以在同一行里自己核对。`);
   if(shares!=null)steps.push(`注意：这是 ${year} 年报时点的股本，不是今天的股本；期间如有增发、回购或送转，与行情日总股本可能不同。`);
  }
  if(key==='book_value_per_share'){
   const equity=row.derived?.book_value_attributable,shares=balance.total_share;
   steps.push(`先取归母净资产：${metricMoney(equity)}；再取年报期末总股本：${shares==null?'尚未取得':num(shares/1e8,4)+' 亿股'}。`);
   steps.push(equity!=null&&shares>0?`计算：${num(equity/1e8,4)} 亿元 ÷ ${num(shares/1e8,4)} 亿股 = ${num(equity/shares,4)} 元/股。计算使用未四舍五入的原值。`:'缺少有效的归母净资产或期末股本，因此不能计算；空白不代表零。');
  }
  if(key==='market_bvps'){
   const equity=row.derived?.book_value_attributable,shares=comparison.quote_shares;
   steps.push(`先取 ${year} 年报归母净资产：${metricMoney(equity)}；再取 ${comparison.trade_date||'行情日'} 的已核对总股本：${shares==null?'尚未取得':num(shares/1e8,4)+' 亿股'}。年报期末股本为 ${balance.total_share==null?'尚未取得':num(balance.total_share/1e8,4)+' 亿股'}，所以表格里的年报口径数字可能不同。`);
   steps.push(equity!=null&&shares>0?`计算：${num(equity/1e8,4)} 亿元 ÷ ${num(shares/1e8,4)} 亿股 = ${num(equity/shares,4)} 元/股。计算使用未四舍五入的原值。`:`${comparison.note||'股本缺失或口径不符，不能与行情比较。'}`);
  }
  if(key==='price_to_book'){
   steps.push(`取 ${comparison.trade_date||'行情日'} 未复权收盘价：${comparison.price==null?'尚未取得':'¥'+num(comparison.price,2)}；取同口径每股账面价值：${comparison.book_value_per_share==null?'尚未取得':'¥'+num(comparison.book_value_per_share,4)}。`);
   steps.push(value!=null?`计算：${num(comparison.price,2)} 元 ÷ ${num(comparison.book_value_per_share,4)} 元/股 = ${num(value,3)} 倍。计算使用未四舍五入的原值。`:`${comparison.note||'报表和行情口径尚不可比，不计算市净率。'}`);
  }
  if(key==='roe_pct'){
   const previous=(archive.annual||[]).find(item=>item.year===Number(year)-1);
   steps.push(`先看分子线索：${year} 年归母净利润为 ${metricMoney(income.n_income_attr_p)}。若有优先股等，还需按归属于普通股股东的利润口径调整。`);
   steps.push(`分母是这一年按时间加权的归母净资产。上年年末归母净资产为 ${metricMoney(previous?.derived?.book_value_attributable)}，本年年末为 ${metricMoney(row.derived?.book_value_attributable)}；分红、增发、回购等发生在年中时还要按月份调整。`);
   steps.push(`概念公式：归属于普通股股东的利润 ÷ 加权平均归属于普通股股东的净资产 × 100%。当前档案没有完整的年内权益变动权重，因此${value==null?'没有可展示的 ROE':'显示数据源给出的 '+num(value)+'%'}，不能用年末净资产冒充精确分母。`);
  }
  if(key==='roic_pct'){
   steps.push('常见理解是：税后经营利润 ÷ 平均投入资本 × 100%。投入资本通常涉及股东权益与有息债务，并需按数据源定义调整。');
   steps.push(`本档案没有取得该接口完整的税后经营利润、平均投入资本及调整口径，因此 ${value==null?'不展示数值':'直接展示数据源给出的 '+num(value)+'%'}，不做无法核实的逐项代入。`);
  }
  if(['roe_roic_gap_pct','roe_roic_reading'].includes(key)){
   const roe=row.derived?.roe_pct,roic=row.derived?.roic_pct,gap=roeRoicGap(row),debt=row.indicators?.interestdebt,assets=balance.total_assets,liabilities=balance.total_liab;
   steps.push(`读取 ${year} 年财务指标：加权平均 ROE ${roe==null?'缺失':num(roe)+'%'}；ROIC ${roic==null?'缺失':num(roic)+'%'}。两者均保留数据源给出的数值，不以年末资产、权益简化复算。`);
   steps.push(gap==null?'缺少 ROE 或 ROIC，暂不能对照；空白不当作零。':`相减：${num(roe)}% − ${num(roic)}% = ${gap>=0?'+':''}${num(gap)} 个百分点。${roeRoicReading(row)}。`);
   steps.push(`继续核查资本结构：总负债 ${metricMoney(liabilities)}、总资产 ${metricMoney(assets)}${assets>0&&liabilities!=null?`，负债/资产约 ${num(liabilities/assets*100)}%`:''}；有息债务 ${metricMoney(debt)}。总负债里也有供应商应付款；这些数仍需结合附注、少数股东权益和非经营项目。`);
  }
  if(key==='wacc_pct'){
   steps.push('概念公式：股权成本 × 股权融资权重 ＋ 税前债务成本 ×（1－适用税率）× 债务融资权重。权重、股权成本、债务成本和税率都要另行估计；年报不能直接给出一个可靠的 WACC。');
   steps.push(value==null?'这家公司尚未保存折现率假设，也没有当前有效的已确认 DCF 情景，因此不填 WACC；不能拿一个通用比例当作公司的数字。':`读取${activeWaccSource}：WACC = ${num(value)}%；保存 ${activeWaccSavedAt||'时间待核'}。这是面向未来的折现率，只用于正式 DCF 与最新年 ROIC 的情景对照，不回写历史各年的资金成本。`);
   steps.push(activeYearWacc==null?'最新年的当年 WACC 尚未算出，历史回看这一块暂时没有可对照的数。':`最新年（${activeLatestYear??'最新'}）按当年公开数据算出的 WACC 是 ${num(activeYearWacc)}%，历史回看用这个数，各年各不相同。`);
   if(value!=null)steps.push(`你保存的假设依据：${activeWaccBasis||'没有可展示的详细依据，请补充核对。'}`);
  }
  if(key==='roic_spread_pct'){
   const roic=row.derived?.roic_pct,waccRow=yearWacc(row),wacc=waccRow?.wacc_pct;
   steps.push(`读取 ${year} 年财务指标 ROIC：${roic==null?'尚未取得':num(roic)+'%'}；读取 ${year} 年当年 WACC：${wacc==null?'尚未取得':num(wacc)+'%'}。这个 WACC 是按这一年的市场数据算出来的资金成本，不是今天的假设回看历史。`);
   steps.push(roic!=null&&wacc!=null?`计算：${num(roic)}% − ${num(wacc)}% = ${(roic-wacc)>=0?'+':''}${num(roic-wacc)} 个百分点。${roic>wacc?'这一年投入资本回报高于当年的资金成本。':roic<wacc?'这一年投入资本回报低于当年的资金成本。':'两者大致相等。'}`:'缺少 ROIC 或当年 WACC，差额留空；缺哪一项见上方「逐年资金成本」面板，不拿别的年份的值顶替。');
   if(waccRow?.premium_note)steps.push(waccRow.premium_note);
  }
  if(key==='wacc_year_pct'){
   const waccRow=yearWacc(row);
   if(!waccRow){
    steps.push('这一年没有算得出的 WACC：缺哪一项见上方「逐年资金成本」面板，不拿别的年份的值顶替。');
   }else{
    steps.push(`无风险利率 Rf ${num(waccRow.rf_pct)}%：中债国债收益率曲线 10 年期，${esc(waccRow.bond_date||'日期待核')}。`);
    steps.push(`税前债务成本 ${num(waccRow.debt_cost_pct)}%：中债中短期票据收益率曲线(AAA) 1 年期，同日。`);
    steps.push(`股权风险溢价 ${num(waccRow.premium_pct)}%：沪深300 官方 PE_TTM ${num(waccRow.pe_ttm,4)}（${esc(waccRow.index_date||'日期待核')}）反推的盈利收益率减 Rf。这是市场隐含口径，不是官方发布的股权风险溢价。`);
    steps.push(`β ${num(waccRow.beta,4)}：个股前复权日收益率对沪深300 日收益率做 OLS 回归，样本 ${waccRow.beta_samples} 个交易日（${esc(waccRow.beta_start||'')}–${esc(waccRow.beta_end||'')}），R² ${num(waccRow.beta_r2,4)}。`);
    steps.push(`股权市值 E ${num(waccRow.equity/1e8,2)} 亿元：当年最后一个交易日（${esc(waccRow.price_date||'待核')}）未复权收盘价 ${num(waccRow.price,2)} 元 × 当年年报期末股本；有息负债 D ${num(waccRow.debt/1e8,2)} 亿元（账面值，代替债务市场价值）；有效税率 T ${num(waccRow.tax_rate_pct)}%。`);
    steps.push(`计算：股权成本 = ${num(waccRow.rf_pct)}% + ${num(waccRow.beta,4)} × ${num(waccRow.premium_pct)}% = ${num(waccRow.cost_of_equity_pct)}%；WACC = 股权占比 ${num(waccRow.equity_weight_pct,2)}% × ${num(waccRow.cost_of_equity_pct)}% + 债务占比 × ${num(waccRow.debt_cost_pct)}% × (1 − ${num(waccRow.tax_rate_pct)}%) = ${num(waccRow.wacc_pct)}%。`);
    if(waccRow.premium_note)steps.push(waccRow.premium_note);
   }
  }
  if(key==='roic_reading'){
   const roic=row.derived?.roic_pct,wacc=activeWacc==null?null:activeWacc*100;
   steps.push(`读取 ${year} 年财务指标 ROIC：${roic==null?'尚未取得':num(roic)+'%'}；读取当前 WACC 假设：${wacc==null?'尚未设置':num(wacc)+'%'}。前者是历史数据源数值，后者来自${activeWaccSource||'尚未保存的研究假设'}，不是历史实测。`);
   steps.push(roic!=null&&wacc!=null?`计算：${num(roic)}% − ${num(wacc)}% = ${(roic-wacc)>=0?'+':''}${num(roic-wacc)} 个百分点。${roic>wacc?'这一年回报高于假设资金成本。':roic<wacc?'这一年回报低于假设资金成本。':'两者大致相等。'}这不等于核实了该年真实 WACC。`:'缺少 ROIC 或已确认 WACC，差额留空，不拿通用比例冒充公司的资金成本。');
  }
  const reports=(archive.filing_index?.documents||[]).filter(item=>item.year===Number(year)&&item.kind==='annual_report');
  const raw=value==null?'尚未取得；空白不代表零':['cash_profit_reading','roe_roic_reading','roic_reading'].includes(key)?value:fieldValue(key,value);
  const simpleExample=key==='roe_pct'&&value!=null&&value>=0?`例如 ${num(value)}% 可以粗略理解为每 100 元平均股东账面资本对应约 ${num(value)} 元年度会计利润；这不是你买入股票后的收益率。`:'';
  const quoteSource=(key==='market_bvps'||key==='price_to_book')?`<p>行情日 ${esc(comparison.trade_date||'待核')} · 收盘价 ${esc(quote?.source||'来源待核')} · 股本 ${esc(quote?.shares_source||'来源待核')}</p>`:'';
  const policy=state?.quality_policy||{},basis=profitBasis(row),cash=row.cash_flow?.n_cashflow_act;
  let guide='金额本身没有通用的“合格区间”；对照多年趋势、同行和原始财报附注。';
  if(['cash_profit_ratio','cash_profit_gap','cash_profit_reading'].includes(key))guide=basis.value==null||cash==null?'数据不足，暂不判断。':basis.value<=0?'净利润非正，倍数不适用；查看亏损原因和现金持续性。':`本工具的阅读区间：低于 0 表示经营现金净流出；0～0.8 倍表示现金明显落后于利润，优先核对营运资金；0.8～1.2 倍表示当年大致接近；高于 1.2 倍表示现金多于利润，也要看预收款、应付款等原因。${basis.exact?`当前 ${num(cash/basis.value,3)} 倍。`:'目前缺少合并净利润，归母口径只作参考，暂不套用区间。'}区间只用于提醒，不参与自动筛选。`;
  if(key==='accounts_receiv_change')guide=value==null?'缺少相邻两年余额，不能判断变化。':value>0?'应收余额上升：结合收入增速、账龄和坏账准备核对回款。':value<0?'应收余额下降：核对是正常回款、减值、转让还是业务收缩。':'应收余额持平：仍需看账龄与减值。';
  if(key==='accounts_receiv')guide=value==null?'暂无余额，不推断为零。':'无统一金额门槛；结合收入、应收变化、账龄和坏账准备判断。';
  if(key==='roe_pct')guide=`你的筛选规则：最近完整年 ROE 至少 ${policy.roe_latest_min??15}%，连续十年均值至少 ${policy.roe_mean_min??15}%，标准差不高于 ${policy.roe_std_max??5} 个百分点，十年最低年份至少 ${policy.roe_year_min??10}%。单年达标不代表十年达标。`;
  if(key==='roic_pct')guide=`当前 ${value==null?'ROIC 缺失':num(value)+'%，属于“'+roicZone(value)+'”'+(roicZoneMeaning(value)?`，意思是“${roicZoneMeaning(value)}”`:'')}。各段含义：${roicZoneMeaningList()}这是阅读提示，不是跨行业合格标准。你的正式筛选规则是最近五年 ROIC 均值至少 ${policy.roic_mean_min??12}%；单年高低不能替代五年均值。${activeWacc==null||value==null?'缺少 ROIC 或已保存 WACC，不能判断是否高于假设资金成本。':`${activeWaccSource} WACC 为 ${num(activeWacc*100)}%，本年 ROIC 与之相差 ${num(value-activeWacc*100)} 个百分点；这是当前假设回看历史。`}`;
  if(['roe_roic_gap_pct','roe_roic_reading'].includes(key))guide=roeRoicGap(row)==null?'缺一项数据，暂不能对照。':`阅读提示：绝对差额不超过 2 个百分点，显示“两项接近”；ROE 高出 ROIC 超过 5 个百分点，提示优先核查债务及指标口径；其余差额按方向提示。当前差额 ${fieldValue('roe_roic_gap_pct',roeRoicGap(row))}，${roeRoicReading(row)}。接近不证明公司没有债务，ROE 较高也不能单凭这两个数判定借债推高。2 和 5 个百分点只是便于定位的提示线，不参与自动筛选。`;
  if(key==='wacc_pct')guide=`WACC 是研究者对资金成本的估计，不是年报披露值，也不是年度实测值。${value==null?'这家公司尚未保存折现率假设；历史回看用各年当年的计算值。':`你保存的折现率假设 ${num(value)}%。`}真正可比的 WACC 需按行业、风险、市场利率、债务结构、税率及币种估算；直接套用一个通用比例不足以证明这家公司的资金成本。`;
  if(key==='roic_spread_pct')guide=yearWacc(row)?`这一行的差额用的是这一年的 WACC，不是今天保存的那个假设——资金成本逐年不同，用今天的数回看历史会得出相反的结论。差额为正表示按当年口径，投入资本回报高于当年的资金成本；为负表示低于。但 WACC 是按公开数据推算的估计值，股权溢价在市场估值极高的年份会失真（页面会标出「口径失真」），单年结果也不能替代多年验证。`:'这一年没有算得出的当年 WACC，差额留空；缺哪一项见上方「逐年资金成本」面板，不拿别的年份的值顶替。';
  if(key==='wacc_year_pct')guide=yearWacc(row)?`WACC 没有任何官方发布的版本，它是研究者按公开数据推算的估计值。逐年算出来的数逐年不同——把「今天的钱有多贵」换回「那一年钱有多贵」，这正是逐年 WACC 的用处。股权风险溢价由沪深300 官方估值反推，市场估值极高的年份会接近甚至低于零，那几年的 WACC 偏低、只能当下限看。`:'这一年没有算得出的 WACC，缺哪一项见上方「逐年资金成本」面板，不拿别的年份的值顶替。';
  if(key==='roic_reading')guide=`ROIC 阅读分段及各自含义：${roicZoneMeaningList()}这些分段仅是阅读示意，不参与筛选。${row.derived?.roic_pct==null?'这年 ROIC 缺失。':`这年 ROIC ${num(row.derived.roic_pct)}%，${roicZone(row.derived.roic_pct)}，意思是“${roicZoneMeaning(row.derived.roic_pct)??'暂无法判断'}”。`}${activeWacc==null?'公司 WACC 尚未保存，无法判断实际 ROIC 是否超过假设资金成本。':`按当前 WACC 假设 ${num(activeWacc*100)}% 回看，差额 ${row.derived?.roic_pct==null?'缺失':(row.derived.roic_pct-activeWacc*100>=0?'+':'')+num(row.derived.roic_pct-activeWacc*100)+' 个百分点'}；长期价值创造仍须连续多年验证。`}`;
  if(key==='price_to_book')guide=value==null?'尚无可比市净率。':value<1?'P/B 低于 1 倍表示股价低于每股账面净资产；应检查资产质量和未来盈利，不自动代表低估。':'P/B 不低于 1 倍表示股价不低于每股账面净资产；不据此单独判断贵或便宜。';
  const yearRow=yearWacc(row);
  const sourceText=(key==='wacc_year_pct'||key==='roic_spread_pct')?(yearRow?`当年 WACC 按各自当年的公开数据算：中债收益率曲线 ${esc(yearRow.bond_date||'日期待核')}（Rf ${num(yearRow.rf_pct)}%、AAA 税前 ${num(yearRow.debt_cost_pct)}%）；沪深300 官方 PE_TTM ${num(yearRow.pe_ttm,4)}（${esc(yearRow.index_date||'日期待核')}）；β 用 ${esc(yearRow.beta_start||'')}–${esc(yearRow.beta_end||'')} 的 ${yearRow.beta_samples} 个交易日回归；股权市值用 ${esc(yearRow.price_date||'日期待核')} 未复权收盘价与当年年报期末股本；有息负债与有效税率来自 ${esc(row.section_sources?.indicators||'来源待核')} 与 ${esc(row.section_sources?.income||'来源待核')}`:'该年缺输入，当年 WACC 尚未取得'):['wacc_pct','roic_reading'].includes(key)?`年度 ROIC：财务指标 ${row.section_sources?.indicators||'来源待核'}；WACC：${activeWaccSource||'尚未保存'} · ${activeWaccSavedAt||'无日期'}`:['roe_roic_gap_pct','roe_roic_reading'].includes(key)?`ROE 与 ROIC：财务指标 ${row.section_sources?.indicators||'来源待核'}；资产和负债：资产负债表 ${row.section_sources?.balance_sheet||'来源待核'}`:['cash_profit_ratio','cash_profit_gap','cash_profit_reading'].includes(key)?`利润表 ${row.section_sources?.income||'来源待核'} · 现金流量表 ${row.section_sources?.cash_flow||'来源待核'} · 应收账款来自资产负债表 ${row.section_sources?.balance_sheet||'来源待核'}`:key==='accounts_receiv_change'?`本年资产负债表 ${source} · 上年资产负债表 ${previousAnnual(archive,row)?.section_sources?.balance_sheet||'来源待核'}`:`${categoryName[section]} · ${source}`;
  return `<h3 id="financial-metric-title">${esc(year)} 年 · ${esc(info.title)}：${esc(raw)}</h3><p class="metric-plain"><strong>大白话</strong> ${esc(info.meaning)}${simpleExample?' '+esc(simpleExample):''}</p><h4>这个数字怎么来的</h4><ol class="metric-steps">${steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol><p class="metric-guide"><strong>参考怎么看</strong> ${esc(guide)}</p><p class="metric-caution"><strong>读这个数时留意</strong> ${esc(info.caution)}</p><div class="metric-source"><strong>数据出处</strong><p>${esc(sourceText)} · 报告年度 ${esc(year)} · ${section==='assumption'?'ROIC 披露':'披露'} ${esc(disclosure.actual_ann_date||'日期待核')} · 抓取 ${esc(disclosure.source_fetched_at||archive.fetched_at||'时间待核')}</p>${section==='assumption'?'<p>下方年报链接只用于核对 ROIC；WACC 来自研究假设，不是年报披露值。</p>':''}${quoteSource}${reports.map(item=>`<a href="${safeLink(item.url)}" target="_blank" rel="noopener">${esc(item.title||year+' 年报原文候选')}</a>`).join(' · ')||'<span class="small muted">尚未建立年报原文链接；可在上方“年报原文与数据版本”查找。</span>'}</div>`;
 }
 function showMetricDialog(year,key){const dialog=document.getElementById('financial-metric-dialog');if(!dialog||!activeArchive)return;dialog.querySelector('.metric-dialog-body').innerHTML=explainFinancialMetric(activeArchive,year,key,activeQuote);if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-financial-metric]');
  if(button){const year=button.dataset.financialYear||[...(activeArchive?.annual||[])].reverse().find(row=>row.income||row.balance_sheet||row.cash_flow||row.indicators)?.year;showMetricDialog(year,button.dataset.financialMetric);return;}
  const asset=event.target.closest('[data-structure-field]');
  if(asset){const row=(activeArchive?.annual||[]).find(item=>String(item.year)===asset.dataset.structureYear),field=asset.dataset.structureField,panel=document.getElementById('structure-detail'),amount=row?.balance_sheet?.[field],total=row?.balance_sheet?.total_assets;if(panel){const label=labels[field]||field;panel.innerHTML=`<strong>${esc(row?.year||'—')} 年 · ${esc(label)}：${fieldValue(field,amount)}</strong><span>总资产 ${fieldValue('total_assets',total)}${amount!=null&&total>0?`，占比 ${num(amount/total*100)}%`:'；数据不足，暂不能计算占比'}。这是账面结构，需核对年报附注及资产可回收性。</span>`;for(const item of document.querySelectorAll('[data-structure-field]'))item.classList.toggle('selected',item===asset);}return;}
  if(event.target.closest('[data-close-financial-metric]')){const dialog=document.getElementById('financial-metric-dialog');if(dialog?.close)dialog.close();else dialog?.removeAttribute('open');}
 });
 function evidenceLinks(ids,map){return (ids||[]).map(id=>{const item=map.get(id);return item?`<a href="${safeLink(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a> <span class="small muted">${esc(item.published_at||'日期未提供')}</span>`:'';}).filter(Boolean).join('<br>')||'<span class="small muted">无可追溯来源</span>';}
 function filingLinks(archive,year){const docs=(archive.filing_index?.documents||[]).filter(item=>item.year===year&&item.kind!=='summary');return docs.map(item=>`<a href="${safeLink(item.url)}" target="_blank" rel="noopener" title="同年官方公告候选，须核对正文与页码">${item.kind==='correction'?'更正公告':'年报原文'}</a>`).join(' · ');}
 function renderStatements(archive){
  return Object.entries(categoryName).map(([section,title])=>{
   const fields=[...new Set(archive.annual.flatMap(row=>Object.keys(row[section]||{})))].filter(key=>key!=='minority_int_source');
   if(!fields.length)return `<details><summary>${title} · 无可用字段</summary><p class="small muted">未取得相应年度数据。</p></details>`;
   return `<details class="statement-detail"><summary>${title} · ${fields.length} 个字段，所有年份</summary><div class="scroll"><table><thead><tr><th>年度</th><th>披露日</th><th>来源 / 抓取时间</th>${fields.map(key=>`<th title="${esc(key)}">${esc(labels[key]||key)}</th>`).join('')}</tr></thead><tbody>${[...archive.annual].reverse().map(row=>`<tr><td>${row.year}</td><td>${esc(row.disclosures?.[section==='balance_sheet'?'balancesheet':section==='cash_flow'?'cashflow':section==='indicators'?'fina_indicator':'income']?.actual_ann_date||'—')}</td><td>${row[section]?esc((row.section_sources?.[section]||row.disclosures?.[section==='balance_sheet'?'balancesheet':section==='cash_flow'?'cashflow':section==='indicators'?'fina_indicator':'income']?.source||'Tushare')+' · '+(row.disclosures?.[section==='balance_sheet'?'balancesheet':section==='cash_flow'?'cashflow':section==='indicators'?'fina_indicator':'income']?.source_fetched_at||archive.fetched_at||'—')):'—'}<br>${filingLinks(archive,row.year)}</td>${fields.map(key=>`<td>${fieldValue(key,row[section]?.[key])}${key==='minority_int'&&String(row.balance_sheet?.minority_int_source||'').includes('还原')?'<small class="basis-note">按恒等式还原</small>':''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  }).join('');
 }
 function renderStructure(row){
  const d=row.derived||{};
  const assetFields=[['货币资金/总资产',d.cash_to_assets_pct,'money_cap'],['应收账款/总资产',d.receivables_to_assets_pct,'accounts_receiv'],['存货/总资产',d.inventory_to_assets_pct,'inventories'],['固定资产/总资产',d.fixed_assets_to_assets_pct,'fix_assets'],['商誉/总资产',d.goodwill_to_assets_pct,'goodwill']];
  const assetBars=assetFields.map(([label,value,field])=>`<button type="button" class="structure-row" data-structure-field="${field}" data-structure-year="${esc(row.year)}" aria-label="查看${label}的构成"><span>${label}</span><progress class="structure-progress" max="100" value="${value==null?0:Math.max(0,Math.min(100,Number(value)))}" aria-hidden="true"></progress><strong>${value==null?'—':num(value)+'%'}</strong></button>`).join('');
  return `<div class="report-chart-grid structure-panel"><div><h4>${esc(row.year||'—')} 年资产构成观察</h4>${assetBars}<div id="structure-detail" class="chart-selection" aria-live="polite">点击任一资产条，查看账面金额和占比。</div><p class="small muted">这些是单项占总资产的比例，未覆盖所有资产，也不表示资产可以按账面金额变现。</p></div><div><h4>${esc(row.year||'—')} 年负债与流动性</h4><div class="structure-facts"><div><span>负债 / 总资产</span><strong>${d.liabilities_to_assets_pct==null?'—':num(d.liabilities_to_assets_pct)+'%'}</strong></div><div><span>有息债务 / 总负债</span><strong>${d.interest_debt_to_liabilities_pct==null?'—':num(d.interest_debt_to_liabilities_pct)+'%'}</strong></div><div><span>流动比率</span><strong>${d.current_ratio==null?'—':num(d.current_ratio,2)+' 倍'}</strong></div><div><span>现金减有息债务参考</span><strong>${fieldValue('cash_less_interest_debt_proxy',d.cash_less_interest_debt_proxy)}</strong></div></div><p class="small muted">现金参考数未扣除受限及经营所需现金；债务风险还需阅读附注、担保和表外承诺。</p></div></div>`;
 }
 function renderBalanceAudit(audit){
  if(!audit)return '<p class="small muted">暂无法核对资产负债表。</p>';
  const rows=audit.rows||[];
  const measured=rows.filter(row=>row.difference!=null);
  const exact=measured.filter(row=>row.difference===0).length;
  const residue=measured.filter(row=>row.difference!==0&&row.state==='passed').length;
  const broken=measured.filter(row=>row.state==='mismatch').length;
  const label=audit.mismatch?`${audit.mismatch} 个年度金额不符，需回查原始年报`:audit.incomplete?`${audit.passed}/${audit.checked} 个已取得年度成立；${audit.incomplete} 个年度字段不全`:`${audit.passed}/${audit.checked} 个年度成立`;
  const detail=measured.length?`可核对的 ${measured.length} 个年度里，${exact} 个三项金额精确相等${residue?`，${residue} 个的差额不足一分钱，是大数相减的浮点计算残差`:''}${broken?`，${broken} 个超出容差`:''}。`:'';
  // 差额显示真实金额，区分“精确相等”“浮点残差”和真实金额差，避免一律显示 0.0000 亿。
  const differenceText=value=>{if(value==null)return '—';const abs=Math.abs(value);if(abs===0)return '0 元';if(abs<0.01)return '不足 1 分';if(abs>=1e8)return num(value/1e8,4)+' 亿元';return num(value,2)+' 元';};
  const pctText=value=>{if(value==null)return '—';if(value===0)return '0%';if(Math.abs(value)<0.0001)return '不足 0.0001%';return num(value,4)+'%';};
  return `<div class="balance-audit ${audit.mismatch?'audit-warning':''}"><strong>资产负债表恒等式：${esc(label)}</strong><p class="small muted">逐年核对“总资产＝总负债＋股东权益合计”，容差为总资产的 0.1% 或 1 万元。${esc(detail)}</p><p class="small muted">这条恒等式由数据源自身满足——同一张报表里的三个字段相加必然等于第三个，所以它几乎总是成立。它的作用是数据搬运的哨兵：发现某个年度的资产负债表换了来源或口径、金额单位错乱、字段错位。恒等式成立不代表资产真实可变现或报表无误。</p>${rows.length?`<details><summary>查看逐年核对结果</summary><div class="scroll"><table><thead><tr><th>年度</th><th>状态</th><th>差额</th><th>差额占总资产</th><th>来源</th></tr></thead><tbody>${[...rows].reverse().map(row=>`<tr><td>${esc(row.year)}</td><td>${row.state==='passed'?'成立':row.state==='mismatch'?'金额不符':'字段不足'}</td><td>${differenceText(row.difference)}</td><td>${pctText(row.difference_pct)}</td><td>${esc(row.source||'未标明')}</td></tr>`).join('')}</tbody></table></div></details>`:''}</div>`;
 }
 function renderFilingLineage(archive){
  const index=archive.filing_index, changes=archive.change_log||[];
  const byYear=new Map();
  for(const row of archive.annual||[]){if(row.year&&!byYear.has(row.year))byYear.set(row.year,[]);}
  for(const item of index?.documents||[]){if(!byYear.has(item.year))byYear.set(item.year,[]);byYear.get(item.year).push(item);}
  const matchedYears=(archive.annual||[]).filter(row=>(byYear.get(row.year)||[]).some(item=>item.kind==='annual_report')).length;
  const missingYears=(archive.annual||[]).filter(row=>!(byYear.get(row.year)||[]).some(item=>item.kind==='annual_report')).map(row=>row.year);
  const links=[...byYear].sort((a,b)=>b[0]-a[0]).map(([year,docs])=>`<tr><td>${esc(year)}</td><td>${docs.filter(x=>x.kind==='annual_report').map(x=>`<a href="${safeLink(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a> <span class="small muted">${esc(x.published_at)}</span>`).join('<br>')||'未找到'}</td><td>${docs.filter(x=>x.kind==='correction').map(x=>`<a href="${safeLink(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a> <span class="small muted">${esc(x.published_at)}</span>`).join('<br>')||'未找到'}</td></tr>`).join('');
  const changed=changes.filter(x=>x.kind==='value_changed');
  const changeRows=[...changes].reverse().map(x=>`<tr><td>${esc(x.checked_at)}</td><td>${esc(x.year)}</td><td>${esc(categoryName[x.section]||x.section)}</td><td>${esc(x.field?labels[x.field]||x.field:'披露日期 / 来源')}</td><td>${x.field?fieldValue(x.field,x.before):esc((x.before_source||'—')+' · '+(x.before_ann_date||'—'))}</td><td>${x.field?fieldValue(x.field,x.after):esc((x.after_source||'—')+' · '+(x.after_ann_date||'—'))}</td><td>${esc(x.kind==='field_added'?'新补字段':x.kind==='field_missing'?'新版本缺字段':x.kind==='source_or_date_changed'?'来源或披露日变化':'数值变化待核')}</td></tr>`).join('');
  return `<div class="filing-lineage"><div class="section-head"><div><h4>年报原文与数据版本</h4><p class="small muted">追踪起点：${esc(archive.tracking_since||archive.fetched_at||'旧档案，首次更新后开始')} · 已记录 ${changes.length} 项变化，其中数值变化 ${changed.length} 项。</p></div><button id="fetch-financial-filings">${index?'重新查找原文':'查找年报原文'}</button></div><p class="small muted">Tushare / AKShare 数值变动只是待核线索，不能直接认定公司重述。公告按公司、年度和标题匹配；打开原文核对具体报表与页码。${archive.retained_previous_sections?`本次接口缺失时保留旧版 ${archive.retained_previous_sections} 张报表，并标注原来源。`:''}</p>${index?`<p class="small muted">巨潮检索状态：${esc(index.state)} · ${esc(index.searched_at)} · ${index.documents?.length||0} 份匹配公告；现有财务档案 ${matchedYears}/${(archive.annual||[]).length} 个年度找到年报原文候选。${missingYears.length?`未匹配年度：${esc(missingYears.join('、'))}。`:''}${esc(index.meaning||'')}${index.errors?.length?` ${index.errors.length} 个时间窗检索失败。`:''}</p><details><summary>查看各年年报与更正公告</summary><div class="scroll"><table><thead><tr><th>报告年度</th><th>年报原文候选</th><th>更正公告线索</th></tr></thead><tbody>${links||'<tr><td colspan="3">尚无匹配的官方公告；可使用下方巨潮检索入口手动查找。</td></tr>'}</tbody></table></div><a href="${safeLink(index.search_url)}" target="_blank" rel="noopener">巨潮资讯手动检索</a></details>`:'<p class="small muted">尚未检索原始年报链接；下方财务数值目前只能定位到数据接口、报告年度与披露日。</p>'}<details><summary>查看更新前后变化 ${changes.length} 项</summary>${changes.length?`<div class="scroll"><table><thead><tr><th>核查时间</th><th>年度</th><th>报表</th><th>字段</th><th>旧值 / 旧披露</th><th>新值 / 新披露</th><th>类别</th></tr></thead><tbody>${changeRows}</tbody></table></div>`:'<p class="small muted">暂无已记录变化。旧档案的创建前历史版本无法倒推。</p>'}</details></div>`;
 }
 function renderCapitalComparison(annual,latest){
  const policy=state?.quality_policy||{},year=Number(latest.year),byYear=new Map(annual.map(row=>[Number(row.year),row]));
  const roeRows=Array.from({length:10},(_,i)=>byYear.get(year-9+i));
  const roeValues=roeRows.map(row=>row?.derived?.roe_pct).filter(Number.isFinite);
  const roeText=roeValues.length<10?`近十年 ROE：取得 ${roeValues.length}/10 年，暂不判断是否持续达标`:(()=>{
   const average=roeValues.reduce((a,b)=>a+b,0)/10,variance=roeValues.reduce((a,b)=>a+(b-average)**2,0)/10,std=Math.sqrt(variance),lowest=Math.min(...roeValues),latestRoe=roeValues[9];
   const ok=average>=(policy.roe_mean_min??15)&&std<=(policy.roe_std_max??5)&&lowest>=(policy.roe_year_min??10)&&latestRoe>=(policy.roe_latest_min??15);
   return `近十年 ROE：均值 ${num(average)}%，波动 ${num(std)} 个百分点，最低 ${num(lowest)}%，最近 ${num(latestRoe)}%；${ok?'符合当前 ROE 数值规则':'未满足当前 ROE 数值规则'}`;
  })();
  const roicRows=Array.from({length:5},(_,i)=>byYear.get(year-4+i));
  const roicValues=roicRows.map(row=>row?.derived?.roic_pct).filter(Number.isFinite);
  const roicText=roicValues.length<5?`近五年 ROIC：取得 ${roicValues.length}/5 年，暂不判断长期表现`:(()=>{
   const average=roicValues.reduce((a,b)=>a+b,0)/5,minimum=policy.roic_mean_min??12;
   // 每一年按各自当年的公开数据算出来的资金成本来对照，不拿一个恒定假设回看历史。
   const roicPairs=roicRows.map(row=>({roic:row?.derived?.roic_pct,wacc:yearWacc(row)?.wacc_pct}))
     .filter(pair=>Number.isFinite(pair.roic)&&Number.isFinite(pair.wacc));
   const relative=roicPairs.length?`；按每年各自的当年 WACC 对照，${roicPairs.filter(pair=>pair.roic>pair.wacc).length}/${roicPairs.length} 个年度 ROIC 高于当年资金成本`:'；逐年 WACC 尚未算出，不能判断资金成本差额';
   return `近五年 ROIC：均值 ${num(average)}%（${average>=minimum?'达到':'未达到'}当前 ${num(minimum)}% 规则）${relative}`;
  })();
  return `<div class="capital-comparison"><div><b>同年对照</b><span>${esc(latest.year||'最新')} 年 ROE ${latest.derived?.roe_pct==null?'—':num(latest.derived.roe_pct)+'%'}、ROIC ${latest.derived?.roic_pct==null?'—':num(latest.derived.roic_pct)+'%'}；${roeRoicGap(latest)==null?'差额待补':fieldValue('roe_roic_gap_pct',roeRoicGap(latest))}。${esc(roeRoicReading(latest))}</span></div><div><b>长期 ROE</b><span>${esc(roeText)}</span></div><div><b>长期 ROIC / WACC</b><span>${esc(roicText)}</span></div></div>`;
 }
 // 资本回报示意带：ROIC 示意分段与当前标的共用一条百分比轴；WACC 只在研究者保存了假设时才标出。
 // 分段常量（ROIC_ZONES / ROIC_NEGATIVE_ZONE）已提到文件前部，避免阈值重复定义。
 // 分段只用于阅读定位，不是筛选条件，也不是跨行业合格线。
 function capitalReturnModel(roic,wacc,year,waccSource){
  const hasRoic=Number.isFinite(roic),hasWacc=Number.isFinite(wacc);
  const zones=ROIC_ZONES.map(zone=>({...zone,active:false}));
  if(hasRoic&&roic<0)zones.unshift({...ROIC_NEGATIVE_ZONE,from:Math.floor(roic)-3,to:0,test:value=>value<0,active:true});
  const zone=hasRoic?zones.find(item=>item.test(roic)):null;
  if(zone)zone.active=true;
  const marker=hasRoic?{value:roic,year:year==null?null:String(year),zone:zone?zone.label:'—',range:zone?zone.range:'—',meaning:zone?zone.meaning:null,inZone:!!zone}:null;
  const waccMarker=hasWacc?{value:wacc,source:waccSource??activeWaccSource}:null;
  const axisMin=Math.min(0,hasRoic?Math.floor(roic):0);
  const axisMax=Math.max(35,hasRoic?roic+6:0,hasWacc?wacc+6:0);
  const spread=hasRoic&&hasWacc?roic-wacc:null;
  // 没有 WACC 假设时图的下半段没有任何内容，图要收短，别留一大片空洞。
  const compact=!hasWacc;
  return {zones,marker,waccMarker,axisMin,axisMax,spread,hasRoic,hasWacc,compact};
 }
 function capitalReturnCaption(model){
  if(!model.hasRoic)return '尚未取得 ROIC，示意分段只说明读法；缺失数据不按零处理，也不推测落点。';
  const base=`最新 ROIC ${num(model.marker.value)}%${model.marker.year?`（${model.marker.year} 年）`:''}，落在「${model.marker.zone}」（${model.marker.range}），含义是「${model.marker.meaning??'暂无法判断'}」。`;
  const wacc=model.hasWacc?`对照的资金成本 ${num(model.waccMarker.value)}%${model.waccMarker.source?`（${model.waccMarker.source}）`:''}，这是估计值，不是年报披露值，也不是年度实测。ROIC − 资金成本 ${model.spread>=0?'+':''}${num(model.spread)} 个百分点。`:'尚无可对照的资金成本（当年计算值未出，研究假设也未保存），无法判断 ROIC 是否高于估计的资金成本。';
  return base+wacc+'示意分段只用于阅读定位，不是筛选条件，也不是跨行业合格线。';
 }
 // 图形几何一律按像素算，不按轴单位：轴单位会跟着图高一起缩放，色带厚度会跟着变粗变细；
// 而且没有 WACC 假设时图的下半段没有任何内容，留着一大片就是空洞。
// 所以色带厚度固定 50px，图高按有没有 WACC 假设分别给 262px / 184px。
const CAPITAL_GRID={left:14,right:18,top:70,bottom:34};
const CAPITAL_BAND={top:18,thickness:50,gap:12};
const CAPITAL_MARK={spreadGap:18,waccLift:48,waccLabelGap:27};
// 从图表坐标反推网格上下沿的像素位置，色带与各种标记都以此为基准。
function capitalBandPixels(api){
 const gridTop=api.coord([0,1])[1],gridBottom=api.coord([0,0])[1];
 const bottom=Math.min(gridTop+CAPITAL_BAND.top+CAPITAL_BAND.thickness,gridBottom-CAPITAL_BAND.gap);
 return {top:bottom-CAPITAL_BAND.thickness,bottom,gridTop,gridBottom};
}
function capitalReturnOption(model){
  const hasRoic=model.hasRoic,hasWacc=model.hasWacc;
  const text=(content,x,y,fill,size,align,halo)=>({type:'text',style:{text:content,x,y,fill,font:`${size}px -apple-system,"PingFang SC",sans-serif`,align:align||'center',verticalAlign:'middle',...(halo?{textBorderColor:'#ffffff',textBorderWidth:3}:{})}});
  const bandSeries={name:'ROIC 示意分段',type:'custom',data:model.zones.map(zone=>[zone.from,zone.to==null?model.axisMax:zone.to]),
   renderItem:(params,api)=>{
    const item=model.zones[params.dataIndex];
    const x0=api.coord([api.value(0),0])[0],x1=api.coord([api.value(1),0])[0];
    const band=capitalBandPixels(api);
    const children=[{type:'rect',shape:{x:x0,y:band.top,width:Math.max(1,x1-x0),height:band.bottom-band.top},style:{fill:item.color,stroke:item.active?'#2b7657':'rgba(45,70,52,0.16)',lineWidth:item.active?2:1}}];
    return {type:'group',children};
   }};
  // 分段标签分两行：上行写区间位置，下行写这一段到底代表什么含义。
  // 含义必须直接显示在界面上，不能只藏在悬停提示里；放不下时整组错层，避免窄段没有标签。
  const zoneLabelSeries={name:'示意分段名称与含义',type:'custom',data:[0],tooltip:{show:false},
   renderItem:(params,api)=>{
    const bandTop=capitalBandPixels(api).top,placed=[],children=[],chartWidth=api.getWidth();
    for(const zone of model.zones){
     const x0=api.coord([zone.from,0])[0],x1=api.coord([zone.to==null?model.axisMax:zone.to,0])[0];
     const center=(x0+x1)/2;
     const rangeWidth=(zone.range||zone.label).length*11,meaningWidth=(zone.meaning||'').length*10.2;
     const width=Math.max(rangeWidth,meaningWidth);
     let tier=0;
     while(placed.some(item=>item.tier===tier&&center-width/2<item.right+10&&center+width/2>item.left-10))tier++;
     placed.push({tier,left:center-width/2,right:center+width/2});
     const half=width/2+4;
     const labelX=Math.min(Math.max(center,half),Math.max(half,chartWidth-half));
     children.push(text(zone.range||zone.label,labelX,bandTop-28-tier*30,zone.active?'#2b7657':zone.text,zone.active?12:11));
     if(zone.meaning)children.push(text(zone.meaning,labelX,bandTop-13-tier*30,zone.active?'#2b7657':'#7d8579',10));
    }
    return {type:'group',children};
   }};
  const roicSeries={name:'最新 ROIC',type:'custom',data:hasRoic?[[model.marker.value]]:[],
   renderItem:(params,api)=>{
    const value=api.value(0),x=api.coord([value,0])[0];
    const band=capitalBandPixels(api);
    const width=api.getWidth(),labelX=Math.min(Math.max(x,58),Math.max(58,width-58));
    const children=[];
    // 虚线只在有 WACC 假设时才画：没有对照对象时，这根线没有去处，只会拖出一截空。
    if(hasWacc)children.push({type:'line',shape:{x1:x,y1:band.top+13,x2:x,y2:band.bottom+CAPITAL_MARK.spreadGap},style:{stroke:'#2b7657',lineWidth:1.5,lineDash:[4,3]}});
    children.push({type:'polygon',shape:{points:[[x-7,band.top],[x+7,band.top],[x,band.top+13]]},style:{fill:'#2b7657'}});
    children.push(text('ROIC '+num(value)+'%',labelX,band.top+27,'#2b7657',12,'center',true));
    return {type:'group',children};
   }};
  const waccMarkerName=model.waccMarker&&model.waccMarker.source&&model.waccMarker.source.includes('当年公开数据')?'当年 WACC':'WACC 假设';
  const waccSeries={name:waccMarkerName,type:'custom',data:hasWacc?[[model.waccMarker.value]]:[],
   renderItem:(params,api)=>{
    const value=api.value(0),x=api.coord([value,0])[0],band=capitalBandPixels(api);
    const y=band.gridBottom-CAPITAL_MARK.waccLift;
    const width=api.getWidth(),labelX=Math.min(Math.max(x,56),width-56);
    const children=[
     {type:'polygon',shape:{points:[[x,y-8],[x+8,y],[x,y+8],[x-8,y]]},style:{fill:'#b79655'}},
     text(waccMarkerName+' '+num(value)+'%',labelX,y+CAPITAL_MARK.waccLabelGap,'#8a6f36',11)];
    return {type:'group',children};
   }};
  const spreadSeries={name:'ROIC − WACC',type:'custom',data:model.spread==null?[]:[[model.waccMarker.value,model.marker.value]],
   renderItem:(params,api)=>{
    const x0=api.coord([api.value(0),0])[0],x1=api.coord([api.value(1),0])[0];
    const y=capitalBandPixels(api).bottom+CAPITAL_MARK.spreadGap;
    const width=api.getWidth(),labelX=Math.min(Math.max((x0+x1)/2,80),width-80);
    const children=[
     {type:'line',shape:{x1:x0,y1:y,x2:x1,y2:y},style:{stroke:'#2b7657',lineWidth:1.4}},
     {type:'line',shape:{x1:x0,y1:y-4,x2:x0,y2:y+4},style:{stroke:'#2b7657',lineWidth:1.4}},
     {type:'line',shape:{x1:x1,y1:y-4,x2:x1,y2:y+4},style:{stroke:'#2b7657',lineWidth:1.4}},
     text((model.spread>=0?'+':'')+num(model.spread)+' 个百分点',labelX,y-11,'#2b7657',11)];
    return {type:'group',children};
   }};
  const tooltip={trigger:'item',formatter:params=>{
   if(params.seriesName==='ROIC 示意分段'){const item=model.zones[params.dataIndex];return item?`${item.range||item.label}：${item.meaning}<br>仅用于阅读定位，不是筛选条件或跨行业合格线`:'';}
   if(params.seriesName==='最新 ROIC')return `最新 ROIC ${num(model.marker.value)}%${model.marker.year?`（${model.marker.year} 年）`:''}<br>落在「${model.marker.range}」区间：${model.marker.meaning??'暂无法判断'}<br>示意分段只用于阅读定位`;
   if(params.seriesName==='WACC 假设'||params.seriesName==='当年 WACC')return `${params.seriesName} ${num(model.waccMarker.value)}%${model.waccMarker.source?`<br>${model.waccMarker.source}`:''}<br>这是研究者估计的资金成本，不是年报披露值`;
   if(params.seriesName==='ROIC − WACC')return `ROIC − WACC ${model.spread>=0?'+':''}${num(model.spread)} 个百分点`;
   if(params.seriesName==='示意分段名称与含义')return '';
   return '';
  }};
  return {tooltip,grid:{left:CAPITAL_GRID.left,right:CAPITAL_GRID.right,top:CAPITAL_GRID.top,bottom:CAPITAL_GRID.bottom},
   xAxis:{type:'value',min:model.axisMin,max:model.axisMax,axisLabel:{formatter:value=>num(value,0)+'%',fontSize:11},splitLine:{lineStyle:{color:'#f1f3ee'}},axisLine:{lineStyle:{color:'#dbe0d8'}}},
   yAxis:{type:'value',min:0,max:1,show:false},
   series:[bandSeries,zoneLabelSeries,...(hasRoic?[roicSeries]:[]),...(hasWacc?[waccSeries]:[]),...(model.spread==null?[]:[spreadSeries])]};
 }
 function renderFinancial(detail){
  const archive=detail.financial_archive;
  activeCapitalModel=null;
  if(!archive)return `<div class="panel"><div class="section-head"><div><h3>上市以来的财务档案</h3><p class="small muted">逐年保存利润表、资产负债表、现金流量表与财务指标。</p></div><button id="fetch-financial-archive" class="primary">获取上市以来财务</button></div><p class="small muted">尚未建立档案。已有十年预筛记录仍可查看；上市以来的缺失年份将单独标出。</p></div>`;
  activeArchive=archive; activeQuote=detail.quote||null;
  activeWaccHistory=window.WaccHistory?.yearMap(detail.wacc_history)||new Map();
  activeValuation=state?.rows?.find(item=>item.symbol===detail.stock.symbol)?.valuation||null;
  const dcfWacc=activeValuation?.inputs?.confirmed===true&&Number.isFinite(activeValuation.inputs.wacc)&&activeValuation.inputs.wacc>0&&activeValuation.inputs.wacc<1?activeValuation.inputs.wacc:null;
  const researchWacc=Number.isFinite(detail.wacc_assumption?.wacc)&&detail.wacc_assumption.wacc>0&&detail.wacc_assumption.wacc<0.5?detail.wacc_assumption.wacc:null;
  activeWacc=dcfWacc??researchWacc;
  activeWaccSource=dcfWacc!=null?'已确认的有效 DCF 情景':researchWacc!=null?'已保存的研究假设':null;
  activeWaccSavedAt=dcfWacc!=null?activeValuation.created_at:researchWacc!=null?detail.wacc_assumption.saved_at:null;
  activeWaccBasis=dcfWacc!=null?activeValuation.inputs.basis:researchWacc!=null?detail.wacc_assumption.basis:null;
  const annual=archive.annual||[], coverage=archive.coverage||{}, comparison=archive.latest_book_to_price||{};
  const latest=[...annual].reverse().find(row=>row.balance_sheet||row.income||row.cash_flow)||{};
  const latestYearWacc=yearWacc(latest)?.wacc_pct;
  activeYearWacc=latestYearWacc; activeLatestYear=latest.year??null;
  // 对照用的资金成本优先用「当年计算值」；当年算不出来时才退回研究假设或正式 DCF 情景。
  const chartWacc=latestYearWacc??(activeWacc==null?null:activeWacc*100);
  const chartWaccSource=latestYearWacc!=null?`${latest.year} 年当年公开数据算出的 WACC`:activeWaccSource;
  activeCapitalModel=capitalReturnModel(latest.derived?.roic_pct??null,chartWacc,latest.year,chartWaccSource);
  const currentValue=state?.rows?.find(row=>row.symbol===detail.stock.symbol)?.valuation?.result?.per_share;
  const comparable=comparison.status==='comparable';
  const bookText=comparable?`<strong>${num(comparison.price_to_book,3)} 倍</strong><span>${comparison.price_below_book?'股价低于账面净资产 '+num(comparison.discount_to_book_pct)+'%':'股价不低于账面净资产'}</span>`:`<strong>待核对</strong><span>${esc(comparison.note||'缺少可比数据')}</span>`;
  return `<div id="value-line-panel" class="panel value-line"><div class="section-head"><div><h3>价值线 · 上市以来的财务档案</h3><p class="small muted">自 ${esc(archive.list_date)} 上市 · 覆盖上市以来全部年度（${coverage.expected_years?.length||0} 年） · ${coverage.available_years?.length||0}/${coverage.expected_years?.length||0} 个完整年度至少有一类数据 · 更新 ${esc(archive.fetched_at)}</p></div><button id="fetch-financial-archive">更新历年财务</button></div><p class="small muted">这是可追溯的公司研究底稿；“有数据”不等于四张表完整。年份空缺、财报重述和会计口径变动均需查看原始年报。${archive.supplement?.added_sections?` AKShare 已补 ${archive.supplement.added_sections} 个缺失年度报表部分（核对 ${esc(archive.supplement.checked_at)}）。`:""}</p>${renderBalanceAudit(archive.balance_audit)}${renderFilingLineage(archive)}<div class="value-line-metrics"><div><span>最新已披露归母净资产</span><button type="button" class="metric-card-button" data-financial-metric="book_value_attributable" data-financial-year="${esc(latest.year)}" aria-label="了解最新归母净资产"><strong>${fieldValue('book_value_attributable',latest.derived?.book_value_attributable)}</strong></button><small>${esc(latest.year||'—')} 年报</small></div><div><span>${comparable?'每股账面价值（行情日股本）':'每股账面价值（年报期末股本）'}</span><button type="button" class="metric-card-button" data-financial-metric="${comparable?'market_bvps':'book_value_per_share'}" data-financial-year="${esc(comparison.book_year)}" aria-label="了解上方每股账面价值的计算口径"><strong>${comparison.book_value_per_share==null?'—':'¥'+num(comparison.book_value_per_share,4)}</strong></button><small>${esc(comparison.book_year||'—')} 年报；${comparable?'按行情日总股本换算':'按年报期末股本计算'}</small></div><div><span>市净率 P/B（收盘价÷每股账面价值）</span><button type="button" class="metric-card-button" data-financial-metric="price_to_book" data-financial-year="${esc(comparison.book_year)}" aria-label="了解市净率的计算过程">${bookText}</button><small>${esc(comparison.trade_date||'行情待更新')} · ${esc(comparison.book_ann_date||'年报披露日待核')}</small></div><div><span>每股内在价值</span><strong>${currentValue==null?'待估值':'¥'+num(currentValue)}</strong><small>仅采用已确认且当前有效的 DCF 情景</small></div></div><p class="notice small">股价低于账面净资产，不等于低于真实价值。应收款、商誉、受限现金、负债和周期损失可能使账面数高估可实现价值；DCF 也取决于你的现金流与折现假设。</p><div class="capital-return-note"><strong>资本回报怎么看</strong><span>最新 ROIC：${latest.derived?.roic_pct==null?"—":num(latest.derived.roic_pct)+"% · "+esc(roicZone(latest.derived.roic_pct))+(roicZoneMeaning(latest.derived.roic_pct)?"（"+esc(roicZoneMeaning(latest.derived.roic_pct))+"）":"")}</span><span>最新年计算 WACC：${activeYearWacc==null?"尚未算出":num(activeYearWacc)+"% · 按 "+esc(String(latest.year||""))+" 年公开市场数据算"}</span><span>你的折现率假设：${activeWacc==null?"未设置 · 正式 DCF 用当前口径 WACC":num(activeWacc*100)+"% · "+esc(activeWaccSource)}</span><span>ROIC－最新年 WACC：${latest.derived?.roic_pct!=null&&activeYearWacc!=null?((latest.derived.roic_pct-activeYearWacc)>=0?"+":"")+num(latest.derived.roic_pct-activeYearWacc)+" 个百分点":"待计算"}</span><span id="current-wacc-line" class="muted">当前口径 WACC（下方分步计算）：读取中…</span>${activeWacc!=null&&activeYearWacc!=null&&latest.derived?.roic_pct!=null?`<span>ROIC－你的假设：${((latest.derived.roic_pct-activeWacc*100)>=0?"+":"")+num(latest.derived.roic_pct-activeWacc*100)+" 个百分点"}</span>`:''}<div class="capital-return-chart-wrap"><div id="capital-return-chart" class="capital-return-chart${activeCapitalModel&&activeCapitalModel.compact?' compact':''}" role="img" aria-label="ROIC 示意分段与当前标的落点对照图"></div><p class="small muted">${esc(capitalReturnCaption(activeCapitalModel))}</p></div>${renderCapitalComparison(annual,latest)}<p class="small muted">ROE / ROIC 差额只提供核查线索，不能单凭差额证明是否靠借债获利。长期对照需有连续年度数据；各年资金成本按各自当年的公开数据算（见「当年 WACC」列与逐年资金成本面板），不用一个恒定假设回看历史。8% / 12% / 20% 的 ROIC 分段仅作示意；WACC 是研究者估计的资金成本，不是年报披露值，也不是年度实测。已保存估值的折现率用于 DCF；历史各年的资金成本保持各自当年口径。页面上出现两个 WACC 不是矛盾，是两个时点：上方「最新年计算 WACC」是当年口径（参数取该年 12 月 31 日前后），回答「2025 年这一年这家公司的资金成本是多少」；下方「WACC 分步计算」是当前口径（参数取最近一个交易日），回答「现在做 DCF 该用什么折现率」。差额主要来自 β 回归窗口的截止日不同（当年截止当年年末，当前截止最近交易日），股权溢价与无风险利率也随日期变动。**历史回看用当年口径，做 DCF 用当前口径。**</p><p class="small muted">历史回看使用各年 WACC；DCF 使用下方分步计算的当前 WACC，直接带入「估值与情景」中的唯一折现率输入框。</p>${detail.wacc_assumption?`<details><summary>查看以前保存的折现率记录</summary><p class="small muted">${num(detail.wacc_assumption.wacc*100)}% · ${esc(detail.wacc_assumption.saved_at||'')}<br>${esc(detail.wacc_assumption.basis||'')}<br>这是历史记录；当前估值采用的数值以「估值与情景」为准。</p></details>`:''}<button type="button" data-view="valuation">查看或调整估值采用的 WACC</button></div>${window.WaccCalculator.render(detail)}${renderStructure(latest)}<div class="report-chart-grid"><div><h4>经营表现 <span class="small muted">亿元</span></h4><div id="archive-performance-chart" class="report-chart" role="img" aria-label="上市以来收入、利润和经营现金流趋势"></div></div><div><h4>财务结构 <span class="small muted">亿元</span></h4><div id="archive-balance-chart" class="report-chart" role="img" aria-label="上市以来资产、负债和归母净资产趋势"></div></div></div><p class="small muted metric-table-hint">点表头或任一数字，查看算法、参考区间和数据出处。现金与利润的差额不等于“未收回的货款”；应收账款另列供核查。合并净利润缺失时仅用归母利润作口径不同的参考。</p><div class="scroll"><table class="annual-overview"><thead><tr><th>年度</th>${["revenue","n_income_attr_p","n_cashflow_act","cash_profit_ratio","cash_profit_gap","accounts_receiv","accounts_receiv_change","total_assets","total_liab","book_value_attributable","total_share","book_value_per_share","roe_pct","roic_pct","roe_roic_gap_pct","wacc_year_pct","roic_spread_pct"].map(key=>`<th>${metricHeader(key)}</th>`).join('')}<th>报表来源</th><th>缺失报表</th></tr></thead><tbody>${[...annual].reverse().map(row=>`<tr><td>${row.year}</td><td>${metricButton(row,'revenue')}</td><td>${metricButton(row,'n_income_attr_p')}</td><td>${metricButton(row,'n_cashflow_act')}</td><td>${metricButton(row,'cash_profit_ratio')}</td><td>${metricButton(row,'cash_profit_gap')}</td><td>${metricButton(row,'accounts_receiv')}</td><td>${metricButton(row,'accounts_receiv_change')}</td><td>${metricButton(row,'total_assets')}</td><td>${metricButton(row,'total_liab')}</td><td>${metricButton(row,'book_value_attributable')}</td><td>${metricButton(row,'total_share')}</td><td>${metricButton(row,'book_value_per_share')}</td><td>${metricButton(row,'roe_pct')}</td><td>${metricButton(row,'roic_pct')}</td><td>${metricButton(row,'roe_roic_gap_pct')}</td><td>${metricButton(row,'wacc_year_pct')}</td><td>${metricButton(row,'roic_spread_pct')}</td><td>${esc(Object.entries(row.section_sources||{}).filter(([,source])=>source&&source!=='Tushare').map(([section,source])=>(categoryName[section]||section)+'：'+source).join('；')||'Tushare / 无补充')}</td><td>${esc((row.missing_sections||[]).map(x=>categoryName[x]||x).join('、')||'—')}</td></tr>`).join('')}</tbody></table></div><dialog id="financial-metric-dialog" class="financial-metric-dialog" aria-labelledby="financial-metric-title"><div class="metric-dialog-top"><span>财务数字说明</span><button type="button" data-close-financial-metric aria-label="关闭说明">关闭 ×</button></div><div class="metric-dialog-body"></div></dialog><details class="report-details"><summary>查看所有年度的完整已取得字段</summary><p class="small muted">金额统一显示为亿元，股本显示为亿股；空白保持“—”，不按零处理。每张表均保留披露日期。</p>${renderStatements(archive)}</details><details class="report-details"><summary>覆盖缺口与来源</summary><p class="small muted">完全空缺的年度：${esc(coverage.missing_years?.join('、')||'无')}。接口错误：${esc(archive.errors?.join('；')||'无')}。免费补充：${esc(archive.supplement?.state||'未运行')}；${esc(Object.values(archive.supplement?.errors||{}).join('；')||archive.supplement?.message||'无错误')}。</p>${(archive.sources||[]).filter((s,i,a)=>a.findIndex(x=>x.api===s.api)===i).map(s=>`<a href="${safeLink(s.url)}" target="_blank" rel="noopener">${esc(categoryName[s.api==='balancesheet'?'balance_sheet':s.api==='cashflow'?'cash_flow':s.api==='fina_indicator'?'indicators':s.api]||s.source||s.api)}接口说明</a>`).join(' · ')}</details></div>`;
 }
 function renderIndustry(detail){
  const bundle=detail.industry_research;
  if(!bundle)return `<div class="panel"><div class="section-head"><div><h3>生意、竞争与行业演化</h3><p class="small muted">一页了解公司做什么、可能的牌照与壁垒、竞争者和行业变化。</p></div><button id="update-industry-research" class="primary">生成有来源的行业草稿</button></div><p class="small muted">尚无行业资料。市场份额需要逐年、同一地区和产品口径的数据；没有可信分母的年份保持空白。</p></div>`;
  const report=bundle.report||{}, sources=new Map((bundle.evidence||[]).map(row=>[row.id,row]));
  const one=report.business_one_liner;
  const shares=report.market_share||[];
  const groups=new Map();
  for(const row of shares){const key=[row.segment,row.geography,row.metric,row.denominator].join(' | ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const source=(ids)=>evidenceLinks(ids,sources);
  const oneLine=one?`<p class="business-one-line">${esc(one.text)}</p><p class="small">${source(one.evidence_ids)}</p>`:'<p class="small muted">一句话业务尚无足够证据，待阅读年报。</p>';
  const licenses=(report.licenses||[]).map(row=>`<div class="research-item"><strong>${esc(row.name)}</strong><p>${esc(row.issuer)} · ${esc(row.scope)}</p><div class="small">${source(row.evidence_ids)}</div></div>`).join('')||'<p class="small muted">尚无核实的公司牌照线索，不能据此判断无需牌照。</p>';
  const competitors=(report.competitors||[]).map(row=>`<div class="research-item"><strong>${esc(row.name)}</strong><p>${esc(row.segment)} · ${esc(row.geography)}</p><div class="small">${source(row.evidence_ids)}</div></div>`).join('')||'<p class="small muted">尚无可追溯的竞争者线索。</p>';
  const moats=(report.moats||[]).map(row=>`<div class="research-item"><span class="pill warning">${esc(moatName[row.type]||row.type)}待核</span><p>${esc(row.claim)}</p><div class="small">${source(row.evidence_ids)}</div></div>`).join('')||'<p class="small muted">尚无足够资料描述壁垒；不应把品牌或牌照当作已被证明的护城河。</p>';
  const timeline=(region)=>{const rows=(report.industry_timeline||[]).filter(row=>region==='china'?/中国|国内|大陆/.test(row.region):!/中国|国内|大陆/.test(row.region));return rows.map(row=>`<div class="history-item"><strong>${esc(row.period)} · ${esc(row.region)}</strong> <span class="pill ${row.kind==='interpretation'?'warning':''}">${row.kind==='interpretation'?'推断':'报道线索'}</span><p>${esc(row.event)}</p><div class="small">${source(row.evidence_ids)}</div></div>`).join('')||'<p class="small muted">暂无可追溯的演化资料。</p>';};
  return `<div id="industry-panel" class="panel industry-panel"><div class="section-head"><div><h3>生意、竞争与行业演化 <span class="pill warning">${esc(bundle.model)} 草稿 · 待核原文</span></h3><p class="small muted">${esc(bundle.created_at)} · ${esc(bundle.scope)}</p></div><button id="update-industry-research">重新搜集</button></div>${oneLine}<div class="report-chart-grid"><div><h4>收入来源</h4>${(report.revenue_drivers||[]).map(row=>`<div class="research-item"><p>${esc(row.claim)}</p><div class="small">${source(row.evidence_ids)}</div></div>`).join('')||'<p class="small muted">待查年报分部披露。</p>'}</div><div><h4>关键牌照与稀缺许可</h4>${licenses}</div></div><div class="report-chart-grid"><div><h4>已发现的竞争者</h4>${competitors}</div><div><h4>壁垒线索</h4>${moats}</div></div><h4>逐年市场份额 <span class="small muted">只比较同产品、地区、分母和计量口径</span></h4>${groups.size?[...groups].map(([key,rows],index)=>`<div class="share-series"><strong>${esc(key)}</strong><p class="small muted">${rows.length} 个有来源的年份；未给出的年份不补线。</p><div id="share-chart-${index}" class="share-chart" role="img" aria-label="${esc(key)}历年份额；点击数据点查看来源"></div><div id="share-detail-${index}" class="chart-selection" aria-live="polite" hidden></div><div class="scroll"><table><thead><tr><th>年份</th><th>份额</th><th>来源</th></tr></thead><tbody>${[...rows].sort((a,b)=>a.year-b.year).map(row=>`<tr><td>${row.year}</td><td>${num(row.share_percent)}%</td><td>${source(row.evidence_ids)}</td></tr>`).join('')}</tbody></table></div></div>`).join(''):'<p class="small muted">尚无满足年份、产品市场、地区、计量口径、分母和来源要求的份额数据。不能估计或绘制逐年变化。</p>'}<div class="report-chart-grid"><div><h4>国内行业演化</h4><div class="industry-timeline">${timeline('china')}</div></div><div><h4>海外可比行业演化</h4><div class="industry-timeline">${timeline('global')}</div></div></div><details><summary>资料缺口和检索覆盖</summary><ul>${(report.missing_information||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul>${(bundle.coverage||[]).map(item=>`<p class="small muted">${esc(item.topic)}：${esc(item.state)}，匹配 ${esc(item.matched??'—')} 条${item.message?'；'+esc(item.message):''}</p>`).join('')}</details></div>`;
 }
 function renderChecklist(detail){
  const list=detail.investment_checklist;if(!list)return '';
  const sections=[...new Set(list.items.map(item=>item.section))],s=list.summary||{};
  const stateName=s.ready?'核心问题已人工核查':s.stale?'有资料更新待复核':s.no?'有未解决疑点':'研究清单未完成';
  return `<form id="investment-checklist-form" class="panel investment-checklist"><div class="section-head"><div><h3>投资核查清单 <span class="pill ${s.ready?'':'warning'}">${stateName}</span></h3><p class="small muted">核心项已核对 ${s.required_yes||0}/${s.required_total||0} · 待复核 ${s.stale||0} · 未通过 ${s.no||0} · 未知 ${s.unknown||0}。勾选只表示你完成了核查，不会自动决定买入。</p></div><button type="submit" class="primary">保存逐项核查</button></div><p class="notice small">每项明确结论须填写至少八字理由和来源。请将“实际控制人品行”落实到可查的履历、处罚、诉讼、关联交易与利益冲突，避免给人贴无法证实的标签。</p>${sections.map(section=>`<details class="checklist-section" ${section==='生意与能力圈'?'open':''}><summary>${esc(section)} · ${list.items.filter(x=>x.section===section&&x.status==='yes'&&!x.stale).length}/${list.items.filter(x=>x.section===section).length} 项已核</summary>${list.items.filter(x=>x.section===section).map(item=>`<div class="checklist-item" data-checklist-item="${esc(item.id)}" ${item.custom?'data-custom="true"':''}><div class="checklist-question"><strong>${esc(item.prompt)}</strong>${item.hard_gate?'<span class="pill">核心项</span>':''}${item.stale?'<span class="pill warning">资料更新，待复核</span>':''}</div><div class="checklist-fields"><label class="field">核查结果<select name="status"><option value="unknown" ${item.status==='unknown'?'selected':''}>待核实</option><option value="yes" ${item.status==='yes'?'selected':''}>已核实且通过</option><option value="no" ${item.status==='no'?'selected':''}>未通过 / 存在疑点</option></select></label><label class="field">依据<textarea name="note" placeholder="核对了什么，结论为何成立">${esc(item.note||'')}</textarea></label><label class="field">来源链接或 data: 内部证据引用，每行一条<textarea name="sources" placeholder="https://...">${esc((item.sources||[]).join('\n'))}</textarea></label>${item.stale?'<label class="checkline"><input type="checkbox" name="reconfirm">我已按更新后的资料重新核对本项</label>':''}</div>${item.custom?`<input type="hidden" name="custom_section" value="${esc(item.section)}"><input type="hidden" name="custom_prompt" value="${esc(item.prompt)}"><input type="hidden" name="custom_hard_gate" value="${item.hard_gate?'true':'false'}">`:''}</div>`).join('')}</details>`).join('')}<div id="custom-checklist-items"></div><div class="checklist-add"><h4>添加自己的核查问题</h4><div class="form-row"><label class="field">分类<input id="custom-checklist-section" placeholder="例如：产品与客户"></label><label class="field">问题<input id="custom-checklist-prompt" placeholder="写成能够核对证据的具体问题"></label></div><label class="checkline"><input id="custom-checklist-hard-gate" type="checkbox">列为核心项</label><button type="button" id="add-checklist-item">增加问题</button></div><button type="submit" class="primary">保存逐项核查</button><p class="small muted">${esc(s.meaning||'清单只帮助你完整核查，不构成投资建议。')}</p></form>`;
 }
 function collectChecklist(form){
  const answers={},custom_items=[];
  for(const node of form.querySelectorAll('[data-checklist-item]')){
   const id=node.dataset.checklistItem;
   answers[id]={status:node.querySelector('[name=status]').value,note:node.querySelector('[name=note]').value,
    sources:node.querySelector('[name=sources]').value.split('\n').map(x=>x.trim()).filter(Boolean),
    reconfirm:!!node.querySelector('[name=reconfirm]')?.checked};
   if(node.dataset.custom==='true')custom_items.push({id,section:node.querySelector('[name=custom_section]').value,
    prompt:node.querySelector('[name=custom_prompt]').value,hard_gate:node.querySelector('[name=custom_hard_gate]').value==='true'});
  }
  return {answers,custom_items};
 }
 function addCustomItem(){
  const section=document.getElementById('custom-checklist-section').value.trim();
  const prompt=document.getElementById('custom-checklist-prompt').value.trim();
  if(!section||prompt.length<6){feedback('请填写分类和至少六字的具体问题。');return;}
  const hard=document.getElementById('custom-checklist-hard-gate').checked;
  const id='custom_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  const item=`<div class="checklist-item" data-checklist-item="${id}" data-custom="true"><div class="checklist-question"><strong>${esc(prompt)}</strong>${hard?'<span class="pill">核心项</span>':''}</div><div class="checklist-fields"><label class="field">核查结果<select name="status"><option value="unknown">待核实</option><option value="yes">已核实且通过</option><option value="no">未通过 / 存在疑点</option></select></label><label class="field">依据<textarea name="note"></textarea></label><label class="field">来源链接，每行一条<textarea name="sources"></textarea></label></div><input type="hidden" name="custom_section" value="${esc(section)}"><input type="hidden" name="custom_prompt" value="${esc(prompt)}"><input type="hidden" name="custom_hard_gate" value="${hard?'true':'false'}"></div>`;
  document.getElementById('custom-checklist-items').insertAdjacentHTML('beforeend',item);
  document.getElementById('custom-checklist-prompt').value='';
  feedback('问题已加入页面；填写后点击“保存逐项核查”。');
 }
 function disposeCharts(){for(const chart of chartInstances)try{chart.dispose();}catch{}chartInstances.length=0;}
 function addChart(id,option,onClick){const target=document.getElementById(id);if(!target||!window.echarts)return;const chart=echarts.init(target);chart.setOption(option);if(onClick)chart.on('click',onClick);chartInstances.push(chart);}

// 当前口径（分步计算）的 WACC：等计算器渲染完再读，它的输入都在 DOM 表单里。
function renderCurrentWaccLine(){
  if(typeof document?.getElementById!=='function')return;
  const holder=document.getElementById('current-wacc-line');
  if(!holder)return;
  try{
   const calc=window.WaccCalculator?.current?.();
   holder.textContent=calc
    ? `当前口径 WACC（下方分步计算）：${num(calc.wacc_pct??calc.wacc)}% · 行情 ${calc.quote_date||'待取'} / ${calc.report_year||'—'} 年报 · 面向未来，用于正式 DCF`
    : '当前口径 WACC（下方分步计算）：尚未算出（参数待补）';
  }catch(err){holder.textContent='当前口径 WACC（下方分步计算）：读取失败';}
 }
 function renderCharts(detail){
  renderCurrentWaccLine();
  if(!window.echarts)return;
  if(activeCapitalModel)addChart('capital-return-chart',capitalReturnOption(activeCapitalModel));
  const annual=detail.financial_archive?.annual||[];
  if(annual.length){
   const years=annual.map(row=>String(row.year));
   const zoom=years.length>18?[{type:'inside',start:Math.max(0,100-1800/years.length),end:100},{type:'slider',height:18,bottom:0,start:Math.max(0,100-1800/years.length),end:100}]:[];
   const base={tooltip:{trigger:'axis',valueFormatter:value=>value==null?'无数据':num(value)+' 亿元'},legend:{top:0},grid:{left:60,right:22,top:42,bottom:years.length>18?54:32},xAxis:{type:'category',data:years,boundaryGap:false,axisLabel:{interval:'auto'}},yAxis:{type:'value',axisLabel:{formatter:value=>num(value,0)}},dataZoom:zoom};
   const series=(name,color,get)=>({name,type:'line',showSymbol:true,symbolSize:6,connectNulls:false,smooth:false,lineStyle:{width:2.5,color},itemStyle:{color},data:annual.map(row=>{const n=get(row);return n==null?null:n/1e8;})});
   const openAnnual=(mapping)=>arg=>{const key=mapping[arg.seriesName],row=annual[arg.dataIndex];if(key&&row)showMetricDialog(row.year,key);};
   addChart('archive-performance-chart',{...base,series:[series('营业总收入','#2b7657',row=>row.income?.total_revenue??row.income?.revenue),series('归母净利润','#bb9558',row=>row.income?.n_income_attr_p),series('经营现金流','#647e9b',row=>row.cash_flow?.n_cashflow_act)]},openAnnual({'营业总收入':'revenue','归母净利润':'n_income_attr_p','经营现金流':'n_cashflow_act'}));
   addChart('archive-balance-chart',{...base,series:[series('总资产','#2b7657',row=>row.balance_sheet?.total_assets),series('总负债','#bb6b5a',row=>row.balance_sheet?.total_liab),series('归母净资产','#647e9b',row=>row.derived?.book_value_attributable)]},openAnnual({'总资产':'total_assets','总负债':'total_liab','归母净资产':'book_value_attributable'}));
  }
  const shares=detail.industry_research?.report?.market_share||[];
  const groups=new Map();
  for(const row of shares){const key=[row.segment,row.geography,row.metric,row.denominator].join(' | ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  let index=0;
  for(const rows of groups.values()){
   const chartIndex=index;
   const points=[...rows].sort((a,b)=>a.year-b.year).map(row=>[row.year,row.share_percent]);
   addChart('share-chart-'+chartIndex,{tooltip:{trigger:'item',formatter:arg=>`${esc(arg.value[0])} 年：${num(arg.value[1])}%<br>点击查看对应来源`},grid:{left:44,right:20,top:16,bottom:38},xAxis:{type:'value',min:Math.min(...points.map(p=>p[0]))-1,max:Math.max(...points.map(p=>p[0]))+1,interval:1,axisLabel:{formatter:value=>String(Math.round(value))}},yAxis:{type:'value',min:0,max:100,axisLabel:{formatter:value=>value+'%'}},series:[{type:'scatter',data:points,symbolSize:13,itemStyle:{color:'#2b7657'}}]},arg=>{const row=[...rows].sort((a,b)=>a.year-b.year)[arg.dataIndex],target=document.getElementById('share-detail-'+chartIndex);if(!row||!target)return;const sources=new Map((detail.industry_research?.evidence||[]).map(item=>[item.id,item]));target.innerHTML=`<strong>${esc(row.year)} 年份额 ${num(row.share_percent)}%</strong><span>${esc(row.segment)} · ${esc(row.geography)} · ${esc(row.metric)}；分母：${esc(row.denominator)}</span><div>来源：${evidenceLinks(row.evidence_ids,sources)}</div>`;target.hidden=false;});
   index++;
  }
  requestAnimationFrame(()=>chartInstances.forEach(chart=>chart.resize()));
 }
 function resizeCharts(){for(const chart of chartInstances)chart.resize();}
 return {renderFinancial,explainFinancialMetric,renderIndustry,renderChecklist,collectChecklist,addCustomItem,disposeCharts,renderCharts,resizeCharts,renderCurrentWaccLine,capitalReturnModel,capitalReturnCaption,capitalReturnOption,renderBalanceAudit};
})();
