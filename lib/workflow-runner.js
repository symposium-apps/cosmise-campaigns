'use strict';

const { buildReport, dateRangeFromQuestion, selectModels } = require('./report-builder');

const WORKFLOW_STAGES = Object.freeze([
  { id: 'scope', label: 'Confirming campaign scope', caption: 'Verifying the account and reporting sources.' },
  { id: 'models', label: 'Loading attribution models', caption: 'Reading the live Campaigns model manifest.' },
  { id: 'performance', label: 'Comparing campaign performance', caption: 'Running the same bounded query across attribution models.' },
  { id: 'trend', label: 'Reading daily trends', caption: 'Checking the shape of performance across the selected period.' },
  { id: 'mapping', label: 'Checking campaign mappings', caption: 'Reviewing mapping coverage and exact-match candidates.' },
  { id: 'diagnostics', label: 'Checking tracking quality', caption: 'Reviewing identity and revenue-quality diagnostics.' },
  { id: 'writing', label: 'Writing the report', caption: 'Turning verified results into a decision-ready report.' },
  { id: 'validation', label: 'Validating the report', caption: 'Checking structure, charts, and credential safety.' },
  { id: 'complete', label: 'Report ready', caption: 'The validated report is ready to review.' }
]);

function workflowTemplate(status = 'queued') {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    status,
    current_stage: status === 'queued' ? 'scope' : null,
    completed: 0,
    total: WORKFLOW_STAGES.length,
    percent: 0,
    summary: status === 'queued' ? 'Waiting to start' : '',
    started_at: null,
    updated_at: timestamp,
    finished_at: null,
    stages: WORKFLOW_STAGES.map((stage) => ({ ...stage, status: 'pending', detail: stage.caption, progress: null, started_at: null, completed_at: null, duration_ms: null }))
  };
}

class WorkflowRunner {
  constructor({ store, mcp, maxConcurrent = 1 }) {
    this.store = store;
    this.mcp = mcp;
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 1);
    this.queue = [];
    this.running = new Set();
  }

  enqueue(reportId) {
    const id = String(reportId || '');
    if (!this.store.rawReport(id) || this.queue.includes(id) || this.running.has(id)) return false;
    if (!this.store.rawReport(id).workflow) this.store.setWorkflow(id, workflowTemplate('queued'));
    this.queue.push(id);
    this.store.patchWorkflow(id, { status: 'queued', summary: this.running.size ? 'Queued behind another report' : 'Starting analysis' });
    queueMicrotask(() => this.drain());
    return true;
  }

  recover() {
    for (const report of this.store.snapshot().reports) {
      if (['queued', 'writing', 'reviewing'].includes(report.status) && !['ready', 'failed'].includes(report.workflow?.status)) this.enqueue(report.id);
    }
  }

  async drain() {
    while (this.running.size < this.maxConcurrent && this.queue.length) {
      const id = this.queue.shift();
      this.running.add(id);
      this.run(id).finally(() => { this.running.delete(id); this.drain(); });
    }
  }

  begin(reportId, stageId, detail, progress = null) {
    this.store.updateWorkflowStage(reportId, stageId, { status: 'running', detail, progress, started_at: new Date().toISOString(), completed_at: null, duration_ms: null }, { status: 'running', current_stage: stageId, summary: detail });
  }

  progress(reportId, stageId, detail, completed, total) {
    this.store.updateWorkflowStage(reportId, stageId, { status: 'running', detail, progress: { completed, total } }, { status: 'running', current_stage: stageId, summary: detail });
  }

  finish(reportId, stageId, detail) {
    const workflow = this.store.rawReport(reportId)?.workflow;
    const stage = workflow?.stages?.find((item) => item.id === stageId);
    const completedAt = new Date().toISOString();
    const duration = stage?.started_at ? Math.max(0, Date.parse(completedAt) - Date.parse(stage.started_at)) : null;
    this.store.updateWorkflowStage(reportId, stageId, { status: 'success', detail, progress: stage?.progress ? { ...stage.progress, completed: stage.progress.total } : null, completed_at: completedAt, duration_ms: duration }, { status: 'running', summary: detail });
  }

  async stage(reportId, stageId, detail, task, successDetail) {
    this.begin(reportId, stageId, detail);
    const result = await task();
    this.finish(reportId, stageId, successDetail || `${detail} complete.`);
    return result;
  }

  async run(reportId) {
    const report = this.store.rawReport(reportId);
    if (!report) return;
    const range = dateRangeFromQuestion(report.question);
    let revision = report.revision;
    this.store.patchWorkflow(reportId, { ...workflowTemplate('running'), status: 'running', current_stage: 'scope', summary: 'Starting read-only analysis', started_at: new Date().toISOString() });
    try {
      const contextBundle = await this.stage(reportId, 'scope', 'Confirming account and reporting sources', () => this.mcp.call('campaign_reports_read_context', { report_id: reportId }), 'Campaign scope and sources confirmed');
      const capabilityRead = await this.stage(reportId, 'models', 'Loading the live attribution model manifest', () => this.mcp.call('campaign_reports_read_capabilities', { report_id: reportId }), 'Available attribution models loaded');
      const models = selectModels(capabilityRead, report.question);
      if (models.length < 2) throw new Error('At least two supported attribution models are required.');

      const query = { start_date: range.start_date, end_date: range.end_date, level: 'campaign', hierarchy: 'type_first', platform: 'all', page: 1, page_size: 50, sort_by: 'spend', sort_order: 'desc', currency: 'USD', include_linked: true, include_unlinked: true, include_self_referrals: false };
      const results = {};
      this.begin(reportId, 'performance', `Reading model 1 of ${models.length}`, { completed: 0, total: models.length });
      for (let index = 0; index < models.length; index += 1) {
        const model = models[index];
        this.progress(reportId, 'performance', `Reading ${model.label} — ${index + 1} of ${models.length}`, index, models.length);
        results[model.key] = await this.mcp.call('campaign_reports_read_performance', { report_id: reportId, query: { ...query, model_key: model.key } });
        this.progress(reportId, 'performance', `${model.label} complete — ${index + 1} of ${models.length}`, index + 1, models.length);
      }
      this.finish(reportId, 'performance', `${models.length} attribution models compared`);

      const trendRead = await this.stage(reportId, 'trend', `Reading daily performance for ${range.label}`, () => this.mcp.call('campaign_reports_read_trend', { report_id: reportId, query: { start_date: range.start_date, end_date: range.end_date, model_key: models[0].key, currency: 'USD', include_self_referrals: false } }), 'Daily performance trend loaded');
      const mappingRead = await this.stage(reportId, 'mapping', 'Reviewing mapping coverage and exact candidates', () => this.mcp.call('campaign_reports_read_mapping_health', { report_id: reportId, query: { start_date: range.start_date, end_date: range.end_date, model_key: models[0].key, page: 1, page_size: 50, include_self_referrals: false }, include_candidates: true }), 'Mapping diagnostics loaded without changes');
      const diagnosticsRead = await this.stage(reportId, 'diagnostics', 'Checking identity and revenue quality', () => this.mcp.call('campaign_reports_read_diagnostics', { report_id: reportId, query: { start_date: range.start_date, end_date: range.end_date, event_sources: ['pixel', 'system'] } }), 'Tracking diagnostics loaded');

      this.begin(reportId, 'writing', 'Composing verified findings and recommendations');
      const built = buildReport({ question: report.question, range, contextRead: contextBundle.context, sourceRead: contextBundle.sources, capabilityRead, models, results, mappingRead, diagnosticsRead, trendRead });
      const saved = await this.mcp.call('campaign_reports_save_markdown', { report_id: reportId, expected_revision: revision, title: built.title, markdown: built.markdown });
      revision = saved.report.revision;
      this.finish(reportId, 'writing', 'Report draft written');

      this.begin(reportId, 'validation', 'Checking report structure, charts, and safety');
      const checked = await this.mcp.call('campaign_reports_validate', { report_id: reportId });
      revision = checked.report.revision;
      if (!checked.validation?.ok) throw new Error(`Report validation failed: ${(checked.validation?.errors || []).join('; ')}`);
      this.finish(reportId, 'validation', 'Report validation passed');

      this.begin(reportId, 'complete', 'Publishing the validated local report');
      const completed = await this.mcp.call('campaign_reports_complete', { report_id: reportId, expected_revision: revision });
      revision = completed.report.revision;
      this.finish(reportId, 'complete', 'Report ready to review');
      this.store.patchWorkflow(reportId, { status: 'ready', current_stage: null, summary: 'Report ready', percent: 100, completed: WORKFLOW_STAGES.length, finished_at: new Date().toISOString() });
    } catch (error) {
      const message = String(error?.message || error || 'Automatic report workflow failed').replace(/csk_[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 300);
      const current = this.store.rawReport(reportId);
      const stageId = current?.workflow?.current_stage;
      if (stageId) this.store.updateWorkflowStage(reportId, stageId, { status: 'failed', detail: message, completed_at: new Date().toISOString() }, { status: 'failed', summary: message, finished_at: new Date().toISOString() });
      try {
        if (current && current.status !== 'failed') await this.mcp.call('campaign_reports_fail', { report_id: reportId, expected_revision: current.revision, detail: message });
      } catch {}
    }
  }
}

module.exports = { WORKFLOW_STAGES, WorkflowRunner, workflowTemplate };
