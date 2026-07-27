(() => {
  function renderOne(node) {
    let spec;
    try { spec = JSON.parse(atob(node.dataset.chart.replace(/-/g, '+').replace(/_/g, '/'))); } catch { return; }
    const canvas = node.querySelector('.chart-canvas');
    if (!canvas || !spec.labels?.length) return;
    const width = Math.max(560, spec.labels.length * 58);
    const height = 280;
    const pad = { left: 52, right: 20, top: 18, bottom: 68 };
    const values = spec.values.map(Number);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);
    const range = max - min || 1;
    const x = (index) => pad.left + (index + 0.5) * ((width - pad.left - pad.right) / values.length);
    const y = (value) => pad.top + (max - value) / range * (height - pad.top - pad.bottom);
    const zeroY = y(0);
    const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
    let marks = '';
    if (spec.type === 'line') {
      marks += `<polyline fill="none" stroke="#176b57" stroke-width="3" points="${values.map((value, index) => `${x(index)},${y(value)}`).join(' ')}"/>`;
      marks += values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="4" fill="#176b57"><title>${escape(spec.labels[index])}: ${value}${escape(spec.unit || '')}</title></circle>`).join('');
    } else {
      const step = (width - pad.left - pad.right) / values.length;
      marks += values.map((value, index) => { const top = Math.min(y(value), zeroY); const h = Math.max(1, Math.abs(y(value) - zeroY)); return `<rect x="${x(index)-step*.32}" y="${top}" width="${step*.64}" height="${h}" rx="4" fill="#176b57"><title>${escape(spec.labels[index])}: ${value}${escape(spec.unit || '')}</title></rect>`; }).join('');
    }
    const labels = spec.labels.map((label, index) => `<text x="${x(index)}" y="${height-42}" text-anchor="end" transform="rotate(-32 ${x(index)} ${height-42})">${escape(label.length > 18 ? `${label.slice(0,17)}…` : label)}</text>`).join('');
    canvas.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(spec.title || 'Campaign chart')}"><line x1="${pad.left}" x2="${width-pad.right}" y1="${zeroY}" y2="${zeroY}" stroke="#cbd5cf"/>${marks}${labels}</svg>`;
  }
  window.renderCampaignCharts = (root = document) => root.querySelectorAll('.campaign-chart').forEach(renderOne);
  document.addEventListener('DOMContentLoaded', () => window.renderCampaignCharts());
})();
