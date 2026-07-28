'use strict';

const { validateReport } = require('./markdown');
const { version } = require('../package.json');
const { AGENT_BOOTSTRAP } = require('./agent-bootstrap');

const TOOLS = [
  { name: 'campaign_reports_get_bootstrap', description: 'Required entry point. Read the private read-only connection, report workflow, verification, and sharing contract.', inputSchema: { type: 'object', properties: {} } },
  { name: 'campaign_reports_get_state', description: 'Read browser-safe report, connection, activity, and selected-view state.', inputSchema: { type: 'object', properties: {} } },
  { name: 'campaign_reports_set_view', description: 'Select the report that the user should see in the Cosmise Campaigns app.', inputSchema: { type: 'object', properties: { report_id: { type: ['string', 'null'] } }, required: ['report_id'] } },
  { name: 'campaign_reports_start', description: 'Start a local Markdown report for one campaign question. Reusing the same message request_id returns the existing report.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, question: { type: 'string' }, request_id: { type: 'string' } }, required: ['question'] } },
  { name: 'campaign_reports_read_context', description: 'Read the credential-scoped campaign context and source policy through the private backend.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' } }, required: ['report_id'] } },
  { name: 'campaign_reports_read_capabilities', description: 'Read available attribution models and the read-only Campaigns contract through the private backend.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' } }, required: ['report_id'] } },
  { name: 'campaign_reports_read_performance', description: 'Read a bounded campaign performance hierarchy for a report.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, query: { type: 'object' } }, required: ['report_id', 'query'] } },
  { name: 'campaign_reports_compare_attribution', description: 'Run the same bounded campaign query under up to six attribution models.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, query: { type: 'object' }, model_keys: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string' } } }, required: ['report_id', 'query', 'model_keys'] } },
  { name: 'campaign_reports_read_trend', description: 'Read daily campaign performance for a report.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, query: { type: 'object' } }, required: ['report_id', 'query'] } },
  { name: 'campaign_reports_read_mapping_health', description: 'Read mapping coverage and optionally exact candidate evidence without changing configuration.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, query: { type: 'object' }, include_candidates: { type: 'boolean' } }, required: ['report_id', 'query'] } },
  { name: 'campaign_reports_read_evidence', description: 'Read bounded attribution evidence for a report.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, query: { type: 'object' } }, required: ['report_id', 'query'] } },
  { name: 'campaign_reports_read_journey', description: 'Read one authorized order journey for a report.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, query: { type: 'object' } }, required: ['report_id', 'query'] } },
  { name: 'campaign_reports_read_diagnostics', description: 'Read first-party identity and revenue-quality diagnostics for a report.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, query: { type: 'object' } }, required: ['report_id', 'query'] } },
  { name: 'campaign_reports_save_markdown', description: 'Save verified analysis as local Markdown using optimistic report revision control.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, expected_revision: { type: 'integer' }, title: { type: 'string' }, markdown: { type: 'string' } }, required: ['report_id', 'expected_revision', 'markdown'] } },
  { name: 'campaign_reports_validate', description: 'Validate report structure, chart blocks, and credential-safety before completion.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' } }, required: ['report_id'] } },
  { name: 'campaign_reports_complete', description: 'Mark a validated local report ready.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, expected_revision: { type: 'integer' } }, required: ['report_id', 'expected_revision'] } },
  { name: 'campaign_reports_fail', description: 'Mark a report failed with a safe explanation.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, expected_revision: { type: 'integer' }, detail: { type: 'string' } }, required: ['report_id', 'expected_revision', 'detail'] } },
  { name: 'campaign_reports_share', description: 'Create an expiring snapshot link for a completed report. Requires explicit confirmation.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, confirm: { type: 'boolean' }, expires_in_hours: { type: 'integer', minimum: 1, maximum: 720 } }, required: ['report_id', 'confirm'] } },
  { name: 'campaign_reports_revoke_share', description: 'Revoke an existing report share link.', inputSchema: { type: 'object', properties: { report_id: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['report_id', 'confirm'] } }
].map((tool) => ({ ...tool, annotations: { readOnlyHint: !['campaign_reports_set_view','campaign_reports_start','campaign_reports_save_markdown','campaign_reports_complete','campaign_reports_fail','campaign_reports_share','campaign_reports_revoke_share'].includes(tool.name), destructiveHint: tool.name === 'campaign_reports_revoke_share' } }));

const BOOTSTRAP = AGENT_BOOTSTRAP;

function text(value, isError = false) { return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }; }
function safeError(error) { return String(error?.message || error || 'Report operation failed').replace(/csk_[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500); }
function handoffFor(report) { return `Your report “${String(report?.title || 'Campaign report').replace(/[“”]/g, '').slice(0, 120)}” is ready in Cosmise Campaigns.`; }
function reportPhase(store, reportId, operation, title, status, detail, startedAt = null) {
  return store.upsertActivity({
    call_id: `phase:${reportId}:${operation}`,
    report_id: reportId,
    operation,
    title,
    status,
    detail,
    duration_ms: startedAt == null ? null : Date.now() - startedAt
  });
}

function createMcp({ store, client, baseUrl = '' }) {
  async function call(name, args = {}) {
    if (name === 'campaign_reports_get_bootstrap') return BOOTSTRAP;
    if (name === 'campaign_reports_get_state') return store.snapshot();
    if (name === 'campaign_reports_set_view') {
      const reportId = args.report_id == null ? null : String(args.report_id);
      const view = store.setView(reportId);
      const report = reportId ? store.rawReport(reportId) : null;
      return { view, ...(report?.status === 'ready' ? { chat_handoff: { reply_exactly: handoffFor(report), duplicate_report_in_chat: false } } : {}) };
    }
    if (name === 'campaign_reports_start') {
      const requestId = String(args.request_id || '').trim();
      const existing = requestId ? store.reportForRequest(requestId, true) : null;
      if (existing) return { report: existing, idempotent_replay: true };
      const report = store.createReport(args);
      reportPhase(store, report.id, 'report_prepare', 'Preparing the analysis', 'success', 'Question captured · read-only workflow ready');
      return { report };
    }
    const reportId = String(args.report_id || '');
    if (!store.rawReport(reportId)) throw new Error('Report not found.');
    if (name === 'campaign_reports_read_context') {
      const [context, sources] = await Promise.all([client.read('context', {}, reportId), client.read('sources', {}, reportId)]);
      return { context, sources };
    }
    if (name === 'campaign_reports_read_capabilities') return client.read('capabilities', {}, reportId);
    if (name === 'campaign_reports_read_performance') return client.read('performance', args.query, reportId);
    if (name === 'campaign_reports_compare_attribution') {
      const models = Array.from(new Set(args.model_keys || [])).slice(0, 6);
      if (models.length < 2) throw new Error('At least two distinct models are required.');
      const startedAt = Date.now();
      reportPhase(store, reportId, 'report_analysis', 'Comparing attribution models', 'running', `${models.length} models queued`);
      try {
        const results = {};
        for (const model of models) results[model] = await client.read('attribution_comparison', { ...args.query, model_key: model }, reportId);
        reportPhase(store, reportId, 'report_analysis', 'Comparing attribution models', 'success', `${models.length} models compared`, startedAt);
        return { models, results };
      } catch (error) {
        reportPhase(store, reportId, 'report_analysis', 'Comparing attribution models', 'failed', safeError(error), startedAt);
        throw error;
      }
    }
    if (name === 'campaign_reports_read_trend') return client.read('trend', args.query, reportId);
    if (name === 'campaign_reports_read_mapping_health') {
      let status = null;
      let statusError = null;
      try { status = await client.read('mapping_health', args.query, reportId); }
      catch (error) { statusError = safeError(error); }
      let candidates = null;
      try { candidates = args.include_candidates ? await client.read('mapping_candidates', args.query, reportId) : null; }
      catch (error) {
        if (!status) throw new Error(statusError || safeError(error));
      }
      if (!status && !candidates) throw new Error(statusError || 'Mapping diagnostics are unavailable.');
      return { status, candidates, limitations: statusError ? ['Aggregate mapping coverage was unavailable; the exact-candidate preview was used instead.'] : [] };
    }
    if (name === 'campaign_reports_read_evidence') return client.read('evidence', args.query, reportId);
    if (name === 'campaign_reports_read_journey') return client.read('journey', args.query, reportId);
    if (name === 'campaign_reports_read_diagnostics') return client.read('diagnostics', args.query, reportId);
    if (name === 'campaign_reports_save_markdown') {
      const startedAt = Date.now();
      reportPhase(store, reportId, 'report_write', 'Writing the report', 'running', 'Composing evidence, calculations, and recommendations');
      try {
        const report = store.updateReport(reportId, { markdown: args.markdown, title: args.title, status: 'writing' }, args.expected_revision);
        reportPhase(store, reportId, 'report_write', 'Writing the report', 'success', 'Markdown report saved', startedAt);
        return { report };
      } catch (error) {
        reportPhase(store, reportId, 'report_write', 'Writing the report', 'failed', safeError(error), startedAt);
        throw error;
      }
    }
    if (name === 'campaign_reports_validate') {
      const startedAt = Date.now();
      reportPhase(store, reportId, 'report_validate', 'Reviewing the report', 'running', 'Checking structure, charts, and safety');
      const validation = validateReport(store.readMarkdown(reportId));
      const report = store.updateReport(reportId, { validation, status: validation.ok ? 'reviewing' : 'writing' });
      reportPhase(store, reportId, 'report_validate', 'Reviewing the report', validation.ok ? 'success' : 'failed', validation.ok ? 'Report passed every validation check' : `${validation.errors.length} validation issue${validation.errors.length === 1 ? '' : 's'}`, startedAt);
      return { validation, report };
    }
    if (name === 'campaign_reports_complete') {
      const current = store.rawReport(reportId);
      if (!current.validation?.ok) throw new Error('Report must pass validation before completion.');
      const report = store.updateReport(reportId, { status: 'ready' }, args.expected_revision);
      reportPhase(store, reportId, 'report_complete', 'Report complete', 'success', 'Evidence-backed report is ready');
      return { report, chat_handoff: { after_select_and_verify_reply_exactly: handoffFor(report), duplicate_report_in_chat: false } };
    }
    if (name === 'campaign_reports_fail') {
      const report = store.updateReport(reportId, { status: 'failed', validation: { ok: false, errors: [safeError(args.detail)], warnings: [] } }, args.expected_revision);
      reportPhase(store, reportId, 'report_complete', 'Report failed', 'failed', safeError(args.detail));
      return { report };
    }
    if (name === 'campaign_reports_share') {
      if (args.confirm !== true) throw new Error('confirm=true is required to share a report.');
      const share = store.createShare(reportId, args.expires_in_hours);
      return { shared: true, url: `${baseUrl}/share/${share.token}`, expires_at: share.expires_at };
    }
    if (name === 'campaign_reports_revoke_share') {
      if (args.confirm !== true) throw new Error('confirm=true is required to revoke a report share.');
      return { revoked: true, report: store.revokeShare(reportId) };
    }
    throw new Error('Unknown app operation.');
  }

  async function handle(message) {
    const id = message?.id ?? null;
    try {
      if (message?.method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'cosmise-campaign-reports', version }, instructions: 'APP-FIRST GATE: for every Campaigns question or follow-up, call campaign_reports_start in the current turn before any data read or answer. Never answer from prior chat data, old reports, cached results, or direct provider tools. Use only these wrapper-exposed tools so the app receives realtime state. Validate, complete, select, and verify the new report. The app report is the complete answer: never duplicate findings, metrics, tables, interpretation, recommendations, or summaries in chat. After ready-and-selected verification, return only the unique title-bearing handoff supplied by campaign_reports_set_view.' } };
      if (message?.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
      if (message?.method === 'notifications/initialized') return null;
      if (message?.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      if (message?.method === 'tools/call') return { jsonrpc: '2.0', id, result: text(await call(String(message?.params?.name || ''), message?.params?.arguments || {})) };
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    } catch (error) {
      return { jsonrpc: '2.0', id, result: text({ ok: false, error: { code: 'report_operation_error', message: safeError(error) } }, true) };
    }
  }

  return { handle, call, tools: () => TOOLS };
}

module.exports = { BOOTSTRAP, TOOLS, createMcp, reportPhase };
