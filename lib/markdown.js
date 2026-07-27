'use strict';

const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

function normalizeChart(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Chart specification must be an object.');
  const type = String(spec.type || 'bar');
  if (!['bar', 'line'].includes(type)) throw new Error('Chart type must be bar or line.');
  const title = String(spec.title || '').slice(0, 120);
  const labels = Array.isArray(spec.labels) ? spec.labels.slice(0, 30).map((value) => String(value).slice(0, 80)) : [];
  const values = Array.isArray(spec.values) ? spec.values.slice(0, 30).map(Number) : [];
  if (!labels.length || labels.length !== values.length || values.some((value) => !Number.isFinite(value))) throw new Error('Chart labels and finite values must have matching lengths.');
  return { type, title, labels, values, unit: String(spec.unit || '').slice(0, 20) };
}

function renderMarkdown(markdown) {
  const charts = [];
  const source = String(markdown || '').replace(/```campaign-chart\s*\n([\s\S]*?)```/g, (_all, raw) => {
    const spec = normalizeChart(JSON.parse(raw));
    const index = charts.push(spec) - 1;
    return `\n\nCAMPAIGNCHARTTOKEN${index}\n\n`;
  });
  let html = marked.parse(source, { gfm: true, breaks: false });
  html = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title'], code: ['class'] },
    allowedSchemes: ['https'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noreferrer noopener', target: '_blank' }) }
  });
  html = html.replace(/<p>CAMPAIGNCHARTTOKEN(\d+)<\/p>/g, (_all, value) => {
    const spec = charts[Number(value)];
    const encoded = Buffer.from(JSON.stringify(spec)).toString('base64url');
    return `<figure class="campaign-chart" data-chart="${encoded}"><div class="chart-canvas"></div><figcaption>${sanitizeHtml(spec.title, { allowedTags: [], allowedAttributes: {} })}</figcaption></figure>`;
  });
  html = html.replace(/<table>/g, '<div class="table-scroll" role="region" tabindex="0" aria-label="Scrollable report table"><table>').replace(/<\/table>/g, '</table></div>');
  return html;
}

function validateReport(markdown) {
  const text = String(markdown || '');
  const errors = [];
  const warnings = [];
  if (!/^#\s+.+/m.test(text)) errors.push('Report needs an H1 title.');
  if (!/##\s+(Scope|Analysis scope)/i.test(text)) errors.push('Report needs a Scope section.');
  if (!/##\s+(Method|Method and limitations|Sources and limitations)/i.test(text)) errors.push('Report needs a method and limitations section.');
  if (/csk_[A-Za-z0-9_-]+|Bearer\s+\S+/i.test(text)) errors.push('Report contains credential-like material.');
  if (/<script|javascript:/i.test(text)) errors.push('Report contains executable markup.');
  try { renderMarkdown(text); } catch (error) { errors.push(String(error.message || error)); }
  if (!/\|.+\|.+\|/m.test(text)) warnings.push('Report contains no Markdown table.');
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { normalizeChart, renderMarkdown, validateReport };
