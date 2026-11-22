/**
 * api/_lib/markdown.js — turn an article's Markdown into what each website
 * platform accepts: HTML (WordPress, Webflow, Shopify) or Wix's rich-content
 * document (Ricos). No dependency; covers what the SEO writer produces:
 * headings, paragraphs, bulleted and numbered lists, block quotes, bold,
 * italic, inline code and links.
 *
 * Every piece of text is escaped, and a link is kept only if it is http(s) —
 * the article is model-written, so nothing in it is trusted as markup.
 */

'use strict';

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

/** Split Markdown into blocks. */
function blocks(md) {
  const out = []; let para = [];
  const flush = () => { if (para.length) { out.push({ type: 'p', text: para.join(' ') }); para = []; } };
  for (const raw of String(md || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push({ type: 'h', level: m[1].length, text: m[2].trim() }); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { flush(); const last = out[out.length - 1]; if (last && last.type === 'ul') last.items.push(m[1]); else out.push({ type: 'ul', items: [m[1]] }); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flush(); const last = out[out.length - 1]; if (last && last.type === 'ol') last.items.push(m[1]); else out.push({ type: 'ol', items: [m[1]] }); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flush(); out.push({ type: 'quote', text: m[1] }); continue; }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** Inline Markdown → a list of runs: { text, bold?, italic?, code?, link? }. */
function runs(text) {
  const out = [];
  const re = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) { const url = safeUrl(m[2]); out.push(url ? { text: m[1], link: url } : { text: m[1] }); }
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ text: m[3] || m[4], bold: true });
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ text: m[5] || m[6], italic: true });
    else out.push({ text: m[7], code: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter(r => r.text);
}

function runsToHtml(text) {
  return runs(text).map(r => {
    let h = esc(r.text);
    if (r.code) h = `<code>${h}</code>`;
    if (r.bold) h = `<strong>${h}</strong>`;
    if (r.italic) h = `<em>${h}</em>`;
    if (r.link) h = `<a href="${esc(r.link)}">${h}</a>`;
    return h;
  }).join('');
}

/**
 * @param {string} md
 * @param {{dropFirstH1?: boolean}} [opts]  platforms show the title themselves, so the H1 is usually dropped
 */
function toHtml(md, opts = {}) {
  let bs = blocks(md);
  if (opts.dropFirstH1 && bs[0] && bs[0].type === 'h' && bs[0].level === 1) bs = bs.slice(1);
  return bs.map(b => {
    if (b.type === 'h') return `<h${b.level}>${runsToHtml(b.text)}</h${b.level}>`;
    if (b.type === 'ul' || b.type === 'ol') return `<${b.type}>${b.items.map(i => `<li>${runsToHtml(i)}</li>`).join('')}</${b.type}>`;
    if (b.type === 'quote') return `<blockquote><p>${runsToHtml(b.text)}</p></blockquote>`;
    return `<p>${runsToHtml(b.text)}</p>`;
  }).join('\n');
}

/** Wix Ricos document. */
function toRicos(md, opts = {}) {
  let bs = blocks(md);
  if (opts.dropFirstH1 && bs[0] && bs[0].type === 'h' && bs[0].level === 1) bs = bs.slice(1);
  const textNodes = (text) => runs(text).map(r => ({
    type: 'TEXT', id: '', nodes: [],
    textData: { text: r.text, decorations: [
      ...(r.bold ? [{ type: 'BOLD', fontWeightValue: 700 }] : []),
      ...(r.italic ? [{ type: 'ITALIC', italicData: true }] : []),
      ...(r.link ? [{ type: 'LINK', linkData: { link: { url: r.link, target: 'BLANK' } } }] : []),
    ] },
  }));
  const para = (text) => ({ type: 'PARAGRAPH', id: '', nodes: textNodes(text), paragraphData: {} });
  const nodes = bs.map(b => {
    if (b.type === 'h') return { type: 'HEADING', id: '', nodes: textNodes(b.text), headingData: { level: Math.min(6, Math.max(2, b.level)) } };
    if (b.type === 'ul' || b.type === 'ol') return { type: b.type === 'ul' ? 'BULLETED_LIST' : 'ORDERED_LIST', id: '', nodes: b.items.map(i => ({ type: 'LIST_ITEM', id: '', nodes: [para(i)] })) };
    if (b.type === 'quote') return { type: 'BLOCKQUOTE', id: '', nodes: [para(b.text)] };
    return para(b.text);
  });
  return { nodes };
}

/** Plain text (for excerpts and checks). */
function toText(md) { return blocks(md).map(b => (b.items ? b.items.join(' ') : b.text)).join('\n').replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, '$1').replace(/[*_`]/g, ''); }

/** Every link URL in the Markdown. */
function links(md) { return [...String(md || '').matchAll(/\[[^\]]+\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g)].map(m => m[1]); }

module.exports = { toHtml, toRicos, toText, links, blocks, runs };
