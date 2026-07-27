'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function now() { return new Date().toISOString(); }
function safeText(value, max = 500) { return String(value || '').replace(/csk_[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, max); }

class ReportStore {
  constructor({ directory }) {
    this.directory = directory;
    this.reportsDirectory = path.join(directory, 'reports');
    this.stateFile = path.join(directory, 'state.json');
    fs.mkdirSync(this.reportsDirectory, { recursive: true });
    this.listeners = new Set();
    this.state = this.load();
  }

  load() {
    try {
      const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return { version: 1, runtime: {}, connection: { state: 'checking', mode: null }, view: { active_report_id: null }, reports: [], activities: [], ...state };
    } catch {
      return { version: 1, runtime: {}, connection: { state: 'checking', mode: null }, view: { active_report_id: null }, reports: [], activities: [] };
    }
  }

  save() {
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.stateFile);
    for (const listener of this.listeners) listener(this.snapshot());
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  snapshot() {
    return JSON.parse(JSON.stringify({
      ...this.state,
      reports: this.state.reports.map(({ share_hash, ...report }) => ({ ...report, shared: Boolean(share_hash) })),
      activities: this.state.activities.slice(0, 100)
    }));
  }

  setRuntime(value) { this.state.runtime = { ...this.state.runtime, ...value }; this.save(); return this.snapshot().runtime; }
  setConnection(value) { this.state.connection = { ...this.state.connection, ...value, updated_at: now() }; this.save(); return this.snapshot().connection; }

  createReport({ title, question }) {
    const id = crypto.randomUUID();
    const report = { id, title: safeText(title || question || 'Campaign analysis', 160), question: safeText(question, 1000), status: 'queued', revision: 1, created_at: now(), updated_at: now(), validation: null, workflow: null, share_hash: null, share_expires_at: null };
    this.state.reports.unshift(report);
    this.state.reports = this.state.reports.slice(0, 50);
    this.state.view.active_report_id = id;
    this.writeMarkdown(id, `# ${report.title}\n\n## Question\n\n${report.question}\n`);
    this.save();
    return this.publicReport(report, true);
  }

  publicReport(report, includeMarkdown = false) {
    if (!report) return null;
    const { share_hash, ...safe } = report;
    return { ...JSON.parse(JSON.stringify(safe)), shared: Boolean(share_hash), ...(includeMarkdown ? { markdown: this.readMarkdown(report.id) } : {}) };
  }

  report(id, includeMarkdown = true) { return this.publicReport(this.state.reports.find((item) => item.id === String(id)), includeMarkdown); }
  rawReport(id) { return this.state.reports.find((item) => item.id === String(id)) || null; }

  readMarkdown(id) { try { return fs.readFileSync(path.join(this.reportsDirectory, `${id}.md`), 'utf8'); } catch { return ''; } }
  writeMarkdown(id, markdown) { fs.writeFileSync(path.join(this.reportsDirectory, `${id}.md`), String(markdown || ''), { mode: 0o600 }); }

  updateReport(id, patch, expectedRevision) {
    const report = this.rawReport(id);
    if (!report) throw new Error('Report not found.');
    if (expectedRevision != null && Number(expectedRevision) !== report.revision) throw new Error('Report revision conflict.');
    if (patch.markdown != null) this.writeMarkdown(report.id, patch.markdown);
    for (const key of ['title', 'status', 'validation']) if (patch[key] !== undefined) report[key] = key === 'title' ? safeText(patch[key], 160) : patch[key];
    report.revision += 1;
    report.updated_at = now();
    this.save();
    return this.publicReport(report, true);
  }

  setWorkflow(id, workflow) {
    const report = this.rawReport(id);
    if (!report) throw new Error('Report not found.');
    report.workflow = JSON.parse(JSON.stringify(workflow || null));
    report.updated_at = now();
    this.save();
    return this.publicReport(report, false).workflow;
  }

  patchWorkflow(id, patch) {
    const report = this.rawReport(id);
    if (!report) throw new Error('Report not found.');
    const current = report.workflow || { version: 1, stages: [] };
    report.workflow = { ...current, ...JSON.parse(JSON.stringify(patch || {})), updated_at: now() };
    if (report.workflow.status === 'running' && report.status === 'queued') report.status = 'writing';
    report.updated_at = now();
    this.save();
    return this.publicReport(report, false).workflow;
  }

  updateWorkflowStage(id, stageId, stagePatch, workflowPatch = {}) {
    const report = this.rawReport(id);
    if (!report) throw new Error('Report not found.');
    const workflow = report.workflow || { version: 1, status: 'queued', stages: [] };
    const stages = Array.isArray(workflow.stages) ? workflow.stages.map((stage) => stage.id === stageId ? { ...stage, ...JSON.parse(JSON.stringify(stagePatch || {})) } : stage) : [];
    const completed = stages.filter((stage) => stage.status === 'success').length;
    const total = stages.length;
    report.workflow = { ...workflow, ...JSON.parse(JSON.stringify(workflowPatch || {})), stages, completed, total, percent: total ? Math.round(completed / total * 100) : 0, updated_at: now() };
    if (report.workflow.status === 'running' && report.status === 'queued') report.status = 'writing';
    report.updated_at = now();
    this.save();
    return this.publicReport(report, false).workflow;
  }

  setView(id) {
    if (id !== null && !this.rawReport(id)) throw new Error('Report not found.');
    this.state.view = { active_report_id: id, updated_at: now() };
    this.save();
    return this.snapshot().view;
  }

  upsertActivity(input) {
    const callId = String(input.call_id || crypto.randomUUID());
    const existing = this.state.activities.find((item) => item.call_id === callId);
    const safe = {
      call_id: callId,
      report_id: input.report_id || null,
      status: String(input.status || 'info'),
      operation: safeText(input.operation, 80),
      title: safeText(input.title, 160),
      detail: safeText(input.detail, 500),
      duration_ms: Number.isFinite(input.duration_ms) ? input.duration_ms : null,
      receipt_fingerprint: input.receipt_fingerprint ? safeText(input.receipt_fingerprint, 160) : null,
      updated_at: now()
    };
    if (existing) Object.assign(existing, safe);
    else this.state.activities.unshift(safe);
    this.state.activities = this.state.activities.slice(0, 100);
    this.save();
    return safe;
  }

  createShare(id, expiresInHours = 168) {
    const report = this.rawReport(id);
    if (!report) throw new Error('Report not found.');
    if (report.status !== 'ready') throw new Error('Only completed reports can be shared.');
    const token = crypto.randomBytes(24).toString('base64url');
    report.share_hash = crypto.createHash('sha256').update(token).digest('hex');
    report.share_expires_at = new Date(Date.now() + Math.min(Math.max(Number(expiresInHours) || 168, 1), 720) * 3600000).toISOString();
    report.updated_at = now();
    this.save();
    return { token, expires_at: report.share_expires_at };
  }

  sharedByToken(token) {
    const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    const report = this.state.reports.find((item) => item.share_hash === hash);
    if (!report || !report.share_expires_at || Date.parse(report.share_expires_at) <= Date.now()) return null;
    return this.publicReport(report, true);
  }

  revokeShare(id) {
    const report = this.rawReport(id);
    if (!report) throw new Error('Report not found.');
    report.share_hash = null;
    report.share_expires_at = null;
    report.updated_at = now();
    this.save();
    return this.publicReport(report, false);
  }
}

module.exports = { ReportStore, safeText };
