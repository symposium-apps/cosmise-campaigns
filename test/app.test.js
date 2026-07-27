'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ReportStore } = require('../lib/store');
const { CampaignClient, READ_NAMES, WRITE_NAMES, activityDetail } = require('../lib/campaign-client');
const { renderMarkdown, validateReport } = require('../lib/markdown');
const { TOOLS, createMcp } = require('../lib/mcp');
const { selectModels } = require('../lib/report-builder');
const { dateRangeFromQuestion } = require('../lib/report-builder');
const { workflowTemplate } = require('../lib/workflow-runner');
const { createApp } = require('../server');

function temporaryStore() { return new ReportStore({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-reports-')) }); }
function fakeClient(store) {
  return {
    configured: () => true,
    verifyReadOnly: async () => ({ read_only: true, campaign_tool_count: 32, credential_write_operations_visible: 0 }),
    read: async (operation, args, reportId) => {
      store.upsertActivity({ call_id: `${operation}-${Date.now()}`, report_id: reportId, operation, status: 'success', title: 'Read complete', detail: 'Safe test read complete.' });
      return { operation, data: { rows: [{ name: 'Example', spend: 10, revenue: 20 }], args }, receipt: { response_fingerprint: 'safe-fingerprint' } };
    }
  };
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function rpc(base, method, params = {}) {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'test', method, params }) });
  return response.json();
}

test('local MCP exposes only app-owned report operations', () => {
  assert(TOOLS.length > 10);
  assert(TOOLS.every((tool) => tool.name.startsWith('campaign_reports_')));
  assert(TOOLS.every((tool) => !tool.name.startsWith('campaigns_')));
  const serialized = JSON.stringify(TOOLS);
  for (const write of WRITE_NAMES) assert.equal(serialized.includes(write), false);
});

test('production credential verification accepts broader credentials while enforcing safe reads', async () => {
  const store = temporaryStore();
  const tools = [
    ...READ_NAMES.map((name) => ({ name, annotations: { readOnlyHint: true } })),
    { name: WRITE_NAMES[0], annotations: { readOnlyHint: false, destructiveHint: true } }
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ result: { tools } }) });
  const client = new CampaignClient({ token: 'not-a-real-secret', store, fetchImpl });
  const proof = await client.verifyReadOnly();
  assert.equal(proof.app_read_only, true);
  assert.equal(proof.credential_write_operations_visible, 1);
  tools.find((tool) => tool.name === READ_NAMES[0]).annotations.readOnlyHint = false;
  await assert.rejects(() => client.verifyReadOnly(), /not marked read-only/);
});

test('safe activity detail exposes workflow scope without production envelopes', () => {
  const detail = activityDetail({ model_key: 'position_based', start_date: '2026-04-01', end_date: '2026-04-30', level: 'campaign', page: 1 });
  assert.equal(detail, 'position based · 2026-04-01 → 2026-04-30 · campaign · page 1');
  assert.doesNotMatch(detail, /authorization|bearer|campaigns_query_table/i);
});

test('Markdown charts render and unsafe markup is removed', () => {
  const markdown = '# Result\n\n## Scope\n\nApril.\n\n| A | B |\n|---|---|\n|x|1|\n\n```campaign-chart\n{"type":"bar","title":"ROAS","labels":["A"],"values":[1.2]}\n```\n\n## Method and limitations\n\nSnapshot.\n\n<script>alert(1)</script>';
  const html = renderMarkdown(markdown);
  assert.match(html, /campaign-chart/);
  assert.doesNotMatch(html, /<script/);
  assert.equal(validateReport(markdown).ok, false, 'executable source should fail validation even when rendered safely');
});

test('report lifecycle is revision-protected and validates before completion', async () => {
  const store = temporaryStore();
  const mcp = createMcp({ store, client: fakeClient(store), baseUrl: 'http://127.0.0.1' });
  const started = await mcp.call('campaign_reports_start', { question: 'Which campaigns performed best?', title: 'Performance review' });
  const id = started.report.id;
  await mcp.call('campaign_reports_read_performance', { report_id: id, query: { start_date: '2026-04-01', end_date: '2026-04-30' } });
  await mcp.call('campaign_reports_compare_attribution', { report_id: id, query: { start_date: '2026-04-01', end_date: '2026-04-30' }, model_keys: ['last_click_client', 'position_based'] });
  const markdown = '# Performance review\n\n## Scope\n\nApril 2026, USD, last click.\n\n| Campaign | Spend | Revenue |\n|---|---:|---:|\n| Example | 10 | 20 |\n\n## Method and limitations\n\nRead-only snapshot; late data may change.\n';
  await assert.rejects(() => mcp.call('campaign_reports_save_markdown', { report_id: id, expected_revision: 0, markdown }), /revision conflict/);
  const saved = await mcp.call('campaign_reports_save_markdown', { report_id: id, expected_revision: 1, markdown });
  const checked = await mcp.call('campaign_reports_validate', { report_id: id });
  assert.equal(checked.validation.ok, true);
  const completed = await mcp.call('campaign_reports_complete', { report_id: id, expected_revision: checked.report.revision });
  assert.equal(completed.report.status, 'ready');
  assert(saved.report.markdown.includes('Performance review'));
  const phases = store.snapshot().activities.filter((item) => item.report_id === id).map((item) => `${item.operation}:${item.status}`);
  for (const expected of ['report_prepare:success','report_analysis:success','report_write:success','report_validate:success','report_complete:success']) assert(phases.includes(expected), `missing ${expected}`);
});

test('HTTP app supports question intake and browser-safe report rendering', async (t) => {
  const store = temporaryStore();
  store.setConnection({ state: 'ready', mode: 'read', message: 'Test connection ready.' });
  const { app } = createApp({ store, client: fakeClient(store), baseUrl: '', autoRun: false });
  const { server, base } = await listen(app);
  t.after(() => server.close());
  const health = await fetch(`${base}/_sym/health`).then((response) => response.json());
  assert.equal(health.production_mode, 'read');
  const created = await fetch(`${base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'What changed?' }) });
  assert.equal(created.status, 201);
  const body = await created.json();
  const report = await fetch(`${base}/api/reports/${body.report.id}`).then((response) => response.json());
  assert.match(report.rendered_html, /What changed/);
  const demo = await fetch(`${base}/demo/workflow`);
  assert.equal(demo.status, 200);
  assert.match(await demo.text(), /What users see while a report is building/);
  const listed = await rpc(base, 'tools/list');
  assert(listed.result.tools.every((tool) => tool.name.startsWith('campaign_reports_')));
});

test('managed runtime honors worker-provided HOST and PORT', async (t) => {
  const port = await availablePort();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-runtime-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CAMPAIGN_REPORTS_DATA_DIR: directory,
      COSMISE_MCP_TOKEN: ''
    },
    stdio: 'ignore'
  });
  t.after(() => child.kill('SIGTERM'));

  let health = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/_sym/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(health, `server did not listen on worker-assigned port ${port}`);
  assert.equal(health.service, 'cosmise-campaigns');
});

test('workflow UI is event-driven, animated, responsive, reduced-motion safe, and shares its spec renderer', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const workflowScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'workflow.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'workflow.css'), 'utf8');
  const polish = fs.readFileSync(path.join(__dirname, '..', 'public', 'workflow-polish.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const spec = fs.readFileSync(path.join(__dirname, '..', 'public', 'workflow-spec.html'), 'utf8');
  assert.match(script, /new EventSource\('\/api\/events\/stream'\)/);
  assert.match(script, /workflow\?\.status==='running'\)details\.open=true/);
  assert.match(workflowScript, /workflow\.stages/);
  assert.match(styles, /@keyframes wf-spin/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(polish, /--build-rainbow:linear-gradient\(95deg,#ff7a3d,#ff5aa0 32%,#8b5cf6 56%,#3d45d8 78%,#22c1a6\)/);
  assert.match(polish, /height:400px;min-height:400px;max-height:400px;overflow:hidden/);
  assert.doesNotMatch(polish, /\.build-card\{[^}]*overflow:(auto|scroll)/);
  assert.match(workflowScript, /slice\(0, 3\)/);
  assert.match(workflowScript, /campaign-reports-icon\.png/);
  assert.match(html, /aria-live="polite"/);
  assert.match(spec, /What users see while a report is building/);
  assert.match(spec, /workflow\.js/);
});

test('Campaign Reports icon is used across marketplace and browser identity surfaces', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'sym-app.json'), 'utf8'));
  const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const preview = fs.readFileSync(path.join(root, 'public', 'workflow-spec.html'), 'utf8');
  assert.equal(manifest.marketplace.icon, 'assets/icon.png');
  assert.equal(manifest.marketplace.accent_color, '#3D45D8');
  assert(fs.existsSync(path.join(root, manifest.marketplace.icon)));
  assert.deepEqual(
    fs.readFileSync(path.join(root, manifest.marketplace.icon)),
    fs.readFileSync(path.join(root, 'public', 'campaign-reports-icon.png')),
    'marketplace and browser artwork must remain byte-identical'
  );
  assert.match(index, /campaign-reports-icon\.png/);
  assert.match(preview, /campaign-reports-icon\.png/);
  assert.doesNotMatch(`${index}\n${preview}\n${JSON.stringify(manifest)}`, /icon\.svg/);
});


test('available-model questions select the full manifest while ordinary reports stay bounded', () => {
  const capabilityRead = { data: { models: Array.from({ length: 19 }, (_, index) => ({ key: index < 6 ? ['last_click_client','first_click_client','total_credit_client','linear','position_based','time_decay'][index] : `model_${index}`, label: `Model ${index}` })) } };
  assert.equal(selectModels(capabilityRead, 'Compare all available attribution models').length, 19);
  assert.equal(selectModels(capabilityRead, 'Give me a campaign report').length, 6);
});

test('mapping candidate diagnostics keep a report usable when aggregate coverage is unavailable', async () => {
  const store = temporaryStore();
  const report = store.createReport({ question: 'Review campaign performance.' });
  const client = {
    read: async (operation) => {
      if (operation === 'mapping_health') throw new Error('Missing combos[]');
      if (operation === 'mapping_candidates') return { operation, data: { status_counts: { proposable: 2 } } };
      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const mcp = createMcp({ store, client, baseUrl: 'http://127.0.0.1' });
  const result = await mcp.call('campaign_reports_read_mapping_health', {
    report_id: report.id,
    query: { start_date: '2026-04-01', end_date: '2026-04-30' },
    include_candidates: true
  });
  assert.equal(result.status, null);
  assert.equal(result.candidates.data.status_counts.proposable, 2);
  assert.deepEqual(result.limitations, ['Aggregate mapping coverage was unavailable; the exact-candidate preview was used instead.']);
});

test('workflow contract persists safe stage progress and date parsing is deterministic', () => {
  const store = temporaryStore();
  const report = store.createReport({ question: 'Review April 2026 campaign performance' });
  store.setWorkflow(report.id, workflowTemplate('queued'));
  store.updateWorkflowStage(report.id, 'performance', { status: 'running', detail: 'Reading model 4 of 6', progress: { completed: 4, total: 6 } }, { status: 'running', current_stage: 'performance' });
  const workflow = store.report(report.id, false).workflow;
  assert.equal(workflow.current_stage, 'performance');
  assert.deepEqual(workflow.stages.find((stage) => stage.id === 'performance').progress, { completed: 4, total: 6 });
  assert.deepEqual(dateRangeFromQuestion('Which campaigns won in April 2026?'), { start_date: '2026-04-01', end_date: '2026-04-30', label: 'April 2026' });
  assert.deepEqual(dateRangeFromQuestion('Analyze April 1 through April 30, 2026.'), { start_date: '2026-04-01', end_date: '2026-04-30', label: 'Apr 1, 2026 to Apr 30, 2026' });
  assert.doesNotMatch(JSON.stringify(workflow), /authorization|bearer|csk_/i);
});
