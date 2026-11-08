'use strict';
// 定性五轴的渲染：生意质量面板（工作台）与结论卡（最终候选页）共用这一处。
//
// 为什么要单独一个模块：同一块定性证据要出现在两个地方。两个地方各写一遍，
// 迟早出现「面板说 8 项可核验、结论卡说 6 项」——同一个数两处两个口径。
//
// 三条规矩：
// 1. **不产生分数。** 强度只有三态：机器可核验／已人工核验／未核验。
//    没有「综合得分」，因为分数会被当依据用，而它不可证伪。
// 2. **「不能证明什么」必须露出。** 不露出的代理指标会被当成结论。
// 3. 颜色与宽度一律走 CSS 类（服务器 CSP 是 style-src 'self'，行内 style 会被静默忽略）。
window.QualitativePanel = (() => {
  const STRENGTH_LABEL = {
    machine: '机器可核验', human: '已人工核验', unknown: '未核验',
    mixed: '机器＋人工', partial: '部分',
  };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function badge(strength, machine, human, unknown) {
    const cls = STRENGTH_LABEL[strength] ? strength : 'partial';
    const parts = [];
    if (machine) parts.push('机器 ' + machine);
    if (human) parts.push('人工 ' + human);
    if (unknown) parts.push('未核 ' + unknown);
    return `<span class="qual-str ${cls}">${esc(parts.join(' · ') || STRENGTH_LABEL[cls])}</span>`;
  }

  // 一行的摘要：机器项的实测值（人工项的题干太长，不进摘要，展开才看）。
  function axisSummary(axis) {
    const machine = (axis.items || []).filter(item => item.strength === 'machine');
    if (!machine.length) return '暂无机器可核验的实测值';
    return machine.map(item => item.text).join('；');
  }

  // 机器项的出处：有官方 PDF 链接就把链接摆出来。
  // 「机器可核验」这四个字要能复核才成立——读者得能顺着链接翻到原文那一页。
  function sourceLinks(item) {
    const sources = (item.sources || []).filter(source => source && source.url);
    if (!sources.length) return '';
    return sources.map(source => {
      const title = source.title || '公告';
      const when = source.published_at ? `（${source.published_at}）` : '';
      const page = source.page ? ` 第 ${source.page} 页` : '';
      return `<a class="qual-src" href="${esc(source.url)}" target="_blank" rel="noopener"`
        + `>${esc(title)}${esc(when)}${esc(page)}</a>`;
    }).join('　');
  }

  function render(gate, options) {
    const opts = options || {};
    const qualitative = (gate || {}).qualitative;
    if (!qualitative || !Array.isArray(qualitative.axes) || !qualitative.axes.length) return '';
    const evidence = qualitative.evidence || {};
    const counts = evidence.counts || {};
    const machine = counts.machine || 0;
    const human = counts.human || 0;
    const unknown = counts.unknown || 0;

    const axisRows = qualitative.axes.map(axis => {
      const items = (axis.items || []).map(item => {
        const tag = STRENGTH_LABEL[item.strength] || item.strength;
        const links = sourceLinks(item);
        return `<li><span class="qual-str ${item.strength}">${esc(tag)}</span> ${esc(item.text)}`
          + (links ? ` ${links}` : '') + `</li>`;
      }).join('');
      return `<li class="qual-axis">`
        + `<span class="qual-axis-name">${esc(axis.label)}</span>`
        + badge(axis.strength, axis.machine_count, axis.human_count, axis.unknown_count)
        + `<span class="qual-axis-items">${esc(axisSummary(axis))}</span>`
        + `<details class="qual-more"><summary>这一轴测的是什么、不能证明什么</summary>`
        + `<p class="qual-cannot">${esc(axis.cannot_prove)}</p>`
        + `<ul class="qual-items">${items}</ul></details>`
        + `</li>`;
    }).join('');

    const unknownList = (evidence.unknown_items || []).map(item => item.text).join('；');
    const redLines = (gate.blockers || []).filter(item => item && item.kind
      && String(item.kind).startsWith('red_line_'));

    return `<div class="qual-block${opts.compact ? ' compact' : ''}">`
      + `<p class="qual-head">定性证据强度`
      + `<span class="muted"> · ${machine} 项可核验（公开年报算出） · ${human} 项已人工核验并留了出处`
      + ` · ${unknown} 项没有依据</span></p>`
      + `<ul class="qual-axes">${axisRows}</ul>`
      + (unknownList
        ? `<p class="qual-unknown"><strong>没有依据的 ${unknown} 项</strong>：${esc(unknownList)}。`
        + `这些要你自己判断，系统没有替你核过。</p>`
        : '')
      + (redLines.length
        ? `<div class="qual-redline"><strong>硬红线命中 ${redLines.length} 条</strong>：`
        + redLines.map(item => esc(item.text)).join('<br>') + `</div>`
        : '')
      + `</div>`;
  }

  return {render, STRENGTH_LABEL, esc};
})();
