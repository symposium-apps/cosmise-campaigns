'use strict';

const express = require('express');
const os = require('node:os');
const path = require('node:path');
const { version } = require('./package.json');
const { AGENT_INSTRUCTIONS } = require('./lib/agent-bootstrap');
const { CampaignClient } = require('./lib/campaign-client');
const { renderMarkdown } = require('./lib/markdown');
const { BOOTSTRAP, TOOLS, createMcp } = require('./lib/mcp');
const { ReportStore } = require('./lib/store');
const { WorkflowRunner } = require('./lib/workflow-runner');

function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function localOnly(req, res, next) {
  const address = String(req.socket.remoteAddress || '');
  if (req.headers['x-forwarded-for'] || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return res.status(403).json({ ok: false, error: 'Local app endpoint only.' });
  next();
}

function createApp({ store, client, baseUrl = '', autoRun = false, runner = null }) {
  const app = express();
  const mcp = createMcp({ store, client, baseUrl });
  const workflowRunner = runner || new WorkflowRunner({ store, mcp });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/_sym/health', (_req, res) => res.json({ ok: true, service: 'cosmise-campaigns', version, backend_mcp_configured: client.configured(), production_mode: 'read', local_tool_count: TOOLS.length }));
  app.get('/api/agent/bootstrap', (_req, res) => res.json(BOOTSTRAP));
  app.get('/api/agent/instructions', (_req, res) => res.json({ instructions: AGENT_INSTRUCTIONS, bootstrap: '/api/agent/bootstrap', mcp: '/mcp' }));
  app.get('/api/state', (_req, res) => res.json(store.snapshot()));
  app.get('/api/reports/:id', (req, res) => {
    const report = store.report(req.params.id, true);
    if (!report) return res.status(404).json({ ok: false, error: 'Report not found.' });
    res.json({ report, rendered_html: renderMarkdown(report.markdown) });
  });
  app.post('/api/reports', localOnly, async (req, res) => {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ ok: false, error: 'Question is required.' });
    if (store.snapshot().connection.state !== 'ready') return res.status(503).json({ ok: false, error: 'Campaign access is not ready yet.' });
    try {
      const started = await mcp.call('campaign_reports_start', { question, title: req.body?.title });
      if (autoRun) workflowRunner.enqueue(started.report.id);
      res.status(201).json({ report: store.report(started.report.id, true), automatic_workflow: autoRun });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
  app.patch('/api/view', (req, res) => {
    try { res.json({ view: store.setView(req.body?.active_report_id ?? null) }); }
    catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
  app.post('/api/reports/:id/share', localOnly, (req, res) => {
    try {
      if (req.body?.confirm !== true) return res.status(400).json({ ok: false, error: 'Confirmation is required.' });
      const share = store.createShare(req.params.id, req.body?.expires_in_hours);
      res.json({ shared: true, url: `${baseUrl}/share/${share.token}`, expires_at: share.expires_at });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
  app.delete('/api/reports/:id/share', localOnly, (req, res) => {
    try {
      if (req.body?.confirm !== true) return res.status(400).json({ ok: false, error: 'Confirmation is required.' });
      res.json({ revoked: true, report: store.revokeShare(req.params.id) });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
  app.get('/api/events/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    const send = (state) => res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    send(store.snapshot());
    const unsubscribe = store.subscribe(send);
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });
  app.get('/spec/workflow', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'workflow-spec.html')));
  app.get('/demo/workflow', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'workflow-spec.html')));
  app.post('/mcp', localOnly, async (req, res) => {
    const result = await mcp.handle(req.body);
    if (result === null) return res.status(202).end();
    res.json(result);
  });
  app.get('/share/:token', (req, res) => {
    const report = store.sharedByToken(req.params.token);
    if (!report) return res.status(404).send('<!doctype html><title>Report unavailable</title><p>This report is unavailable or expired.</p>');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.title)}</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/responsive.css?v=1.0.0"></head><body class="share-page"><main class="shared-report"><div class="share-mark">Campaign Report</div><article class="markdown-body">${renderMarkdown(report.markdown)}</article><footer>Snapshot generated ${escapeHtml(report.updated_at)}</footer></main><script src="/chart.js" defer></script></body></html>`);
  });
  app.get('/', (_req, res) => {
    // The document's response headers control whether Symposium may frame it.
    // Never let a browser retain an older anti-iframe policy after an update.
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  app.use(express.static(path.join(__dirname, 'public'), { index: false, etag: true, maxAge: '1h' }));
  if (autoRun) queueMicrotask(() => workflowRunner.recover());
  return { app, mcp, runner: workflowRunner };
}

function lanAddress() {
  for (const values of Object.values(os.networkInterfaces())) for (const entry of values || []) if (entry.family === 'IPv4' && !entry.internal) return entry.address;
  return '127.0.0.1';
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4318);
  const host = process.env.HOST || '0.0.0.0';
  const dataDirectory = process.env.CAMPAIGN_REPORTS_DATA_DIR || path.join(__dirname, '.sym-data');
  const store = new ReportStore({ directory: dataDirectory });
  const client = new CampaignClient({ token: process.env.COSMISE_MCP_TOKEN, endpoint: process.env.COSMISE_MCP_URL, store });
  store.setRuntime({ backend_mcp_configured: client.configured(), production_mode: 'read', raw_production_tools_exposed: false, app_tool_count: TOOLS.length });
  store.setConnection({ state: client.configured() ? 'checking' : 'missing_key', mode: client.configured() ? 'read' : null, message: client.configured() ? 'Verifying Campaigns read access.' : 'Synchronize the Cosmise connection and restart this app.' });
  if (client.configured()) client.verifyReadOnly().then((proof) => store.setConnection({ state: 'ready', mode: 'read', message: 'Campaign access is ready. This app enforces read-only operations.', proof })).catch((error) => store.setConnection({ state: 'error', mode: null, message: error.message }));
  const baseUrl = `http://127.0.0.1:${port}`;
  const { app } = createApp({ store, client, baseUrl });
  app.listen(port, host, () => {
    console.log(`Cosmise Campaigns: ${baseUrl}`);
    console.log(`LAN: http://${lanAddress()}:${port}`);
  });
}

module.exports = { createApp, localOnly };
