'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// 静态快照模式。
//
// 只在构建出来的静态站点里加载（deploy/build_static.py 负责注入到 index.html）。
// 私有服务器上的工作台完全不受影响——那份仍然走真正的后端接口。
//
// GitHub Pages / Cloudflare Pages 只能托管静态文件，没有 /api/* 这种后端接口。
// 所以这里把 window.fetch 包一层：
//   读接口 → 去取构建时预生成的 JSON；
//   写接口 → 直接拒绝，并把「该去哪操作」讲清楚，而不是让它静默失败。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  const here = document.currentScript ? new URL('.', document.currentScript.src) : new URL('./', location.href);
  const base = here.href;
  const READONLY = '静态快照版本只能查看：保存审核结论、重算筛选、重新取数都要回到私有服务器上的工作台操作。';

  // 接口路径 → 预生成 JSON 的相对位置
  const FILES = {
    'state': 'data/state.json',
    'market-mood': 'data/market-mood.json',
    'risk-free-rate': 'data/risk-free-rate.json',
    'export': 'data/export.json',
    'candidates.csv': 'data/candidates.csv',
  };

  function target(path) {
    const url = new URL(path, location.origin);
    const p = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
    if (p.startsWith('company/')) return 'data/companies/' + p.slice('company/'.length) + '.json';
    if (p.startsWith('wacc-history/')) return 'data/wacc-history/' + p.slice('wacc-history/'.length) + '.json';
    if (p.startsWith('cyclicality/')) return 'data/cyclicality/' + p.slice('cyclicality/'.length) + '.json';
    if (p === 'cost-of-capital') return 'data/cost-of-capital/' + (url.searchParams.get('code') || '') + '.json';
    return FILES[p] || null;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (!raw.startsWith('/api/')) return nativeFetch(input, init);
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return Promise.resolve(new Response(JSON.stringify({ error: READONLY }), {
        status: 501, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }));
    }
    const rel = target(raw);
    if (!rel) {
      return Promise.resolve(new Response(JSON.stringify({ error: '静态版本没有这个接口：' + raw }), {
        status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }));
    }
    return nativeFetch(new URL(rel, base)).then(r => {
      if (!r.ok) throw Error('静态版本读不到 ' + rel + '（这份数据在生成快照时还没有）');
      return r;
    });
  };

  // 生成时间写进页面，让人一眼看出这份快照有多旧。
  const stamp = document.getElementById('static-built-at');
  if (stamp) {
    nativeFetch(new URL('data/manifest.json', base)).then(r => r.json()).then(m => {
      stamp.textContent = (m.built_at || '').replace('T', ' ').slice(0, 16);
      if (m.codes) stamp.textContent += '（含 ' + m.codes + ' 家公司的完整档案）';
    }).catch(() => { stamp.textContent = '未知'; });
  }

  window.StaticSite = { enabled: true, base: base, readonly: READONLY };
})();
