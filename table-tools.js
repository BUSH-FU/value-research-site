'use strict';
// 表格筛选与排序引擎。
//
// 为什么单独一个模块：本项目有 18 张表，散在 6 个前端文件里，每张表的列含义都不一样。
// 把「点表头能排序、每列能筛选、缺数据永远排最后」这条规则收在一处，才能保证处处一致，
// 不用在每个渲染函数里各写一遍——散着写就会出现「这张表能排、那张表不能排」的不一致。
//
// 三条硬规矩（和页面其他部分一致）：
// 1. 只改显示顺序与可见性，不改任何数字。
// 2. 缺数据（—、待补、未取到）永远排在最后，升降序都一样——缺数据不是「最小值」，
//    把它排在最前会让人以为那是最好的记录。
// 3. 服务器 CSP 是 style-src 'self'，行内 style 属性会被浏览器静默忽略（这个坑本项目踩过三次）。
//    所以外观一律走 CSS 类；只有表头偏移这种必须算出来的数才用 CSSOM 赋值。
window.TableTools = (() => {
 const collator = new Intl.Collator('zh-Hans-CN', {numeric: true, sensitivity: 'base'});
 // 表示「这一格没有数」的字样：排序时永远排最后，筛选时可以被搜到。
 const MISSING = new Set(['—', '–', '-', '待补', '数据待补', '分红数据待补', '未取到',
  '尚未拉取', '暂无', '报价不可用', '情景不完整', '不可比较', '股权为负']);

 const states = new Map();        // 身份 -> {sortIndex, sortDir, filters:{}}
 const contexts = new WeakMap();  // table  -> 上下文
 const identities = new WeakMap();// table  -> 身份串
 const cellCache = new WeakMap(); // td     -> {raw, value}
 const live = new Set();          // 仍在页面上的上下文（用来断开已移除表格的观察器）
 let scheduled = false;

 function norm(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

 // 单元格文本：<br> 要当分隔符。textContent 不会给 <br> 留位置，
 // 而「¥10.51<br><span>2026-10-29</span>」这种写法在页面上有好几处，
 // 不拆开的话会被读成 10.512026 这种数。
 // 注意：这里必须返回字符串而不是往参数里累加——字符串按值传递，
 // 递归里累加的参数传不回去，结果会变成空串（多行单元格全废）。
 function walk(node) {
  let out = '';
  for (const child of node.childNodes) {
   if (child.nodeType === 3) { out += child.nodeValue; continue; }
   if (child.nodeType !== 1) continue;
   if (child.tagName === 'BR') { out += ' '; continue; }
   out += walk(child);
  }
  return out;
 }
 function cellText(cell) {
  if (!cell) return '';
  if (!cell.childElementCount) return norm(cell.textContent);
  return norm(walk(cell));
 }

 // 从显示文本里取数。取不到就返回 null（按文字处理）。
 function parseNumber(raw) {
  const text = String(raw ?? '').replace(/[¥￥,，]/g, '').trim();
  if (!text) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  m = /^([-+]?[\d.]+)\s*[～~至]\s*([-+]?[\d.]+)$/.exec(text);
  if (m) {
   const low = Number(m[1]), high = Number(m[2]);
   return Number.isFinite(low) && Number.isFinite(high) ? Math.min(low, high) : null;
  }
  m = /^[≤≥<>=]?\s*([-+]?[\d.]+)/.exec(text);
  if (m) {
   const n = Number(m[1]);
   return Number.isFinite(n) ? n : null;
  }
  return null;
 }

 function computeValue(raw) {
  if (MISSING.has(raw)) return {missing: true, num: null, raw};
  const num = parseNumber(raw);
  return {missing: false, num, raw};
 }
 function parseCell(cell) {
  if (!cell) return {missing: true, num: null, raw: ''};
  const raw = cellText(cell);
  const explicit = cell.dataset.ttValue;
  if (explicit !== undefined && explicit !== '') {
   const n = Number(explicit);
   return {missing: false, num: Number.isFinite(n) ? n : null, raw};
  }
  const cached = cellCache.get(cell);
  if (cached && cached.raw === raw) return cached.value;
  const value = computeValue(raw);
  cellCache.set(cell, {raw, value});
  return value;
 }

 function compareValues(a, b, dir) {
  if (a.missing && b.missing) return 0;
  if (a.missing) return 1;   // 缺数据永远在最后，不随方向变化
  if (b.missing) return -1;
  if (a.num !== null && b.num !== null) return (a.num - b.num) * dir;
  if (a.num !== null) return -dir;
  if (b.num !== null) return dir;
  return collator.compare(a.raw, b.raw) * dir;
 }

 function searchText(raw) {
  return String(raw ?? '').toLowerCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ');
 }
 // 筛选表达式：>10 / >=10 / <10 / <=10 / =10 / 10-20 走数值比较；
 // 其余（含裸数字）按文字包含匹配——裸数字按包含而不是按等值，
 // 是因为「20」既该命中「2020」这条年度，也该命中「20%」。
 function matchFilter(value, expr) {
  const q = String(expr ?? '').trim();
  if (!q) return true;
  let m = /^([<>]=?|=)\s*(-?\d+(?:\.\d+)?)$/.exec(q);
  if (m) {
   if (value.num === null) return false;
   const n = Number(m[2]);
   if (m[1] === '>') return value.num > n;
   if (m[1] === '>=') return value.num >= n;
   if (m[1] === '<') return value.num < n;
   if (m[1] === '<=') return value.num <= n;
   return value.num === n;
  }
  m = /^(-?\d+(?:\.\d+)?)\s*[-～~至]\s*(-?\d+(?:\.\d+)?)$/.exec(q);
  if (m) {
   if (value.num === null) return false;
   const low = Number(m[1]), high = Number(m[2]);
   return value.num >= Math.min(low, high) && value.num <= Math.max(low, high);
  }
  return searchText(value.raw).includes(searchText(q));
 }

 // 表头文字：排除排序按钮自己，免得加完按钮后签名变了。
 // 精选标的表用的是自己的排序按钮（.sort-arrow），箭头变了也不能算成另一张表，
 // 否则用户一排序，之前设的筛选条件就没了。
 function headerLabel(cell) {
  const clone = cell.cloneNode(true);
  clone.querySelectorAll('.tt-sort,.tt-arrow,.sort-arrow').forEach(node => node.remove());
  return norm(clone.textContent);
 }
 function signatureOf(table) {
  const row = table.tHead && table.tHead.rows[0];
  if (!row) return '';
  return [...row.cells].map(headerLabel).join('|');
 }
 // 同一批表里可能有几张表头完全一样（比如批量测算的主表与补充表），
 // 用出现序号区分，签名相同但序号不同 → 各自保存自己的排序与筛选。
 function computeIdentities() {
  const seen = new Map();
  for (const table of document.querySelectorAll('table')) {
   const sig = signatureOf(table);
   const n = seen.get(sig) || 0;
   seen.set(sig, n + 1);
   identities.set(table, sig + '#' + n);
  }
 }

 // 纵向可滚动的容器：有 max-height 才算（否则页面滚动时表头会飘到窗口顶端，
 // 多张表的表头会叠在一起）。
 function scrollHost(table) {
  let el = table.parentElement;
  while (el && el !== document.body) {
   const cs = getComputedStyle(el);
   if (/auto|scroll/.test(cs.overflowY)) return cs.maxHeight === 'none' ? null : el;
   el = el.parentElement;
  }
  return null;
 }

 function baseOrder(ctx) {
  const tbody = ctx.table.tBodies[0];
  if (!tbody) return [];
  const current = [...tbody.rows];
  const set = new Set(current);
  const kept = ctx.originalOrder.filter(row => set.has(row));
  if (kept.length !== ctx.originalOrder.length || kept.length !== current.length) ctx.originalOrder = current.slice();
  return ctx.originalOrder;
 }

 function applyFilters(ctx) {
  const tbody = ctx.table.tBodies[0];
  if (!tbody) return;
  const filters = ctx.state.filters;
  let visible = 0, total = 0;
  for (const row of tbody.rows) {
   total++;
   let show = true;
   for (let i = 0; i < ctx.cols; i++) {
    const expr = filters[i];
    if (!expr) continue;
    if (!matchFilter(parseCell(row.cells[i]), expr)) { show = false; break; }
   }
   row.classList.toggle('tt-hidden', !show);
   if (show) visible++;
  }
  ctx.visible = visible;
  ctx.total = total;
 }

 function applySort(ctx) {
  const tbody = ctx.table.tBodies[0];
  if (!tbody) return;
  const st = ctx.state;
  const order = baseOrder(ctx);
  if (st.sortIndex < 0) { tbody.append(...order); return; }
  const dir = st.sortDir;
  const decorated = order.map((row, index) => ({row, index, value: parseCell(row.cells[st.sortIndex])}));
  decorated.sort((a, b) => {
   const c = compareValues(a.value, b.value, dir);
   return c !== 0 ? c : a.index - b.index;
  });
  tbody.append(...decorated.map(item => item.row));
 }

 function updateArrows(ctx) {
  const st = ctx.state;
  for (const item of ctx.sortButtons) {
   const active = st.sortIndex === item.index;
   item.button.classList.toggle('active', active);
   const arrow = item.button.firstElementChild;
   if (arrow) arrow.textContent = active ? (st.sortDir > 0 ? '▲' : '▼') : '↕';
   item.button.setAttribute('aria-label', '按「' + item.label + '」' + (active ? (st.sortDir > 0 ? '升序' : '降序') : '排序'));
  }
 }

 function updateCount(ctx) {
  if (!ctx.count) return;
  const st = ctx.state;
  const parts = ['显示 ' + (ctx.visible ?? 0) + ' / ' + (ctx.total ?? 0) + ' 行'];
  if (st.sortIndex >= 0) {
   const label = (ctx.sortButtons.find(item => item.index === st.sortIndex) || {}).label || ('第 ' + (st.sortIndex + 1) + ' 列');
   parts.push('按「' + label + '」' + (st.sortDir > 0 ? '升序' : '降序'));
  }
  const active = Object.keys(st.filters).filter(key => st.filters[key]).length;
  if (active) parts.push(active + ' 列在筛选');
  ctx.count.textContent = parts.join(' · ');
  if (ctx.clear) ctx.clear.disabled = st.sortIndex < 0 && !active;
 }

 function apply(ctx) {
  applyFilters(ctx);
  applySort(ctx);
  updateArrows(ctx);
  updateCount(ctx);
 }

 // 排序真的变了才往外广播：重绘后恢复状态时不能再广播，否则会自己跟自己循环。
 function announceSort(ctx) {
  const sync = ctx.table.dataset.ttSync;
  if (!sync) return;
  const tbody = ctx.table.tBodies[0];
  if (!tbody) return;
  const keys = [...tbody.rows].map(row => row.dataset.ttKey || '');
  document.dispatchEvent(new CustomEvent('table-tools:sorted', {
   detail: {sync, keys, column: ctx.state.sortIndex, dir: ctx.state.sortDir, identity: ctx.identity},
  }));
 }

 function toggleSort(ctx, col) {
  const st = ctx.state;
  if (st.sortIndex !== col) { st.sortIndex = col; st.sortDir = 1; }
  else if (st.sortDir > 0) { st.sortDir = -1; }
  else { st.sortIndex = -1; st.sortDir = 1; }
  apply(ctx);
  announceSort(ctx);
 }

 function enhance(table) {
  if (table.dataset.ttReady) return;
  const head = table.tHead;
  const headRow = head && head.rows[0];
  if (!headRow || !headRow.cells.length) return;
  const cols = headRow.cells.length;
  const identity = identities.get(table) || (signatureOf(table) + '#0');
  const state = states.get(identity) || {sortIndex: -1, sortDir: 1, filters: {}};
  states.set(identity, state);

  // 已经有原生排序按钮的表（精选标的）不抢它的排序，只加筛选。
  const nativeSort = !!table.querySelector('thead th button[data-pool-sort]');
  const ctx = {
   table, identity, state, cols, nativeSort,
   originalOrder: [], sortButtons: [], visible: 0, total: 0,
   filters: {}, observer: null,
  };
  contexts.set(table, ctx);
  live.add(ctx);
  table.dataset.ttReady = '1';
  table.classList.add('tt-table');

  // 筛选行：每列一个输入框，紧贴表头。
  const filterRow = document.createElement('tr');
  filterRow.className = 'tt-filters';
  for (let i = 0; i < cols; i++) {
   const th = document.createElement('th');
   const label = headerLabel(headRow.cells[i]);
   if (label) {
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'tt-filter';
    input.dataset.ttCol = String(i);
    input.placeholder = '筛选';
    input.setAttribute('aria-label', '按「' + label + '」筛选');
    if (state.filters[i]) input.value = state.filters[i];
    th.appendChild(input);
   }
   filterRow.appendChild(th);
  }
  head.appendChild(filterRow);
  ctx.filterRow = filterRow;

  // 排序按钮：表头文字本身就是按钮的（如财务总表的 ⓘ 说明），不能把表头包进按钮，
  // 所以只在表头末尾追加一个只带箭头的按钮。
  if (!nativeSort) {
   for (let i = 0; i < cols; i++) {
    const th = headRow.cells[i];
    const label = headerLabel(th);
    if (!label) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tt-sort';
    button.dataset.ttCol = String(i);
    const arrow = document.createElement('span');
    arrow.className = 'tt-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↕';
    button.appendChild(arrow);
    button.setAttribute('aria-label', '按「' + label + '」排序');
    th.appendChild(button);
    ctx.sortButtons.push({index: i, button, label});
   }
  }

  // 工具条：显示多少行、清除筛选与排序、语法提示。
  const toolbar = document.createElement('div');
  toolbar.className = 'tt-toolbar';
  const count = document.createElement('span');
  count.className = 'tt-count';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'tt-clear';
  clear.textContent = '清除筛选与排序';
  const hint = document.createElement('span');
  hint.className = 'tt-hint small muted';
  hint.textContent = '筛选支持 >10、>=10、<10、<=10、=10、10-20；裸数字按文字包含匹配（如 20 命中 2020）';
  toolbar.append(count, clear, hint);
  let anchor = table;
  const parent = table.parentElement;
  if (parent && parent.classList.contains('scroll')) anchor = parent;
  if (anchor.parentElement) anchor.parentElement.insertBefore(toolbar, anchor);
  ctx.toolbar = toolbar;
  ctx.count = count;
  ctx.clear = clear;

  let timer = null;
  filterRow.addEventListener('input', event => {
   const input = event.target.closest('.tt-filter');
   if (!input) return;
   const col = Number(input.dataset.ttCol);
   state.filters[col] = input.value;
   if (timer) clearTimeout(timer);
   timer = setTimeout(() => apply(ctx), 120);
  });
  filterRow.addEventListener('keydown', event => {
   if (event.key !== 'Enter') return;
   event.preventDefault();
   if (timer) clearTimeout(timer);
   apply(ctx);
  });
  clear.addEventListener('click', () => {
   state.sortIndex = -1;
   state.sortDir = 1;
   state.filters = {};
   filterRow.querySelectorAll('.tt-filter').forEach(input => { input.value = ''; });
   apply(ctx);
   announceSort(ctx);
  });

  table.addEventListener('click', event => {
   if (ctx.nativeSort) return;
   const button = event.target.closest('.tt-sort');
   if (button) { event.stopPropagation(); toggleSort(ctx, Number(button.dataset.ttCol)); return; }
   const th = event.target.closest('thead tr:first-child th');
   if (!th) return;
   if (event.target.closest('button')) return;  // 表头里的说明按钮不触发排序
   const col = [...th.parentElement.children].indexOf(th);
   if (col >= 0) toggleSort(ctx, col);
  });

  // 纵向可滚动的容器里，表头与筛选行一起吸顶。
  if (scrollHost(table)) {
   table.classList.add('tt-sticky');
   const sync = () => {
    const h = headRow.getBoundingClientRect().height;
    if (h > 0) for (const th of filterRow.cells) th.style.top = h + 'px';
   };
   ctx.syncSticky = sync;
   requestAnimationFrame(sync);
   if (window.ResizeObserver) {
    ctx.observer = new ResizeObserver(() => sync());
    ctx.observer.observe(headRow);
   }
  }

  apply(ctx);
 }

 function enhanceAll() {
  computeIdentities();
  for (const table of document.querySelectorAll('table')) {
   if (table.dataset.ttReady) continue;
   enhance(table);
  }
  for (const ctx of [...live]) {
   if (ctx.table.isConnected) continue;
   if (ctx.observer) ctx.observer.disconnect();
   live.delete(ctx);
  }
 }

 function schedule() {
  if (scheduled || typeof requestAnimationFrame !== 'function') return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; enhanceAll(); });
 }

 // 换表头顺序（年度顺序开关）时必须清掉表内排序，
 // 否则新顺序刚排好就被恢复出来的排序盖掉，用户会觉得开关失灵。
 function clearSortIn(root) {
  const scope = root || document;
  for (const table of scope.querySelectorAll('table')) {
   const ctx = contexts.get(table);
   if (!ctx) continue;
   if (ctx.state.sortIndex < 0) continue;
   ctx.state.sortIndex = -1;
   ctx.state.sortDir = 1;
   apply(ctx);
   announceSort(ctx);
  }
 }

 const observer = hasDom() && typeof MutationObserver !== 'undefined' ? new MutationObserver(() => schedule()) : null;
 if (observer) observer.observe(document.documentElement, {childList: true, subtree: true});
 if (hasDom()) schedule();

 function hasDom() {
  return typeof document !== 'undefined' && typeof document.documentElement !== 'undefined';
 }

 return {clearSortIn, enhanceAll, schedule, rules: {parseNumber, compareValues, matchFilter, cellText, computeValue}};
})();
