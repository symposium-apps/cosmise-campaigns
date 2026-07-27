'use strict';

const crypto = require('node:crypto');

const DEFAULT_ENDPOINT = 'https://cosmise.com/api/mcp';
const WRITE_NAMES = Object.freeze([
  'campaigns_create_mapping', 'campaigns_set_mapping', 'campaigns_delete_mapping',
  'campaigns_merge_combos', 'campaigns_unmerge_combos',
  'campaigns_set_extraction_rule', 'campaigns_delete_extraction_rule',
  'campaigns_set_drill_alias', 'campaigns_delete_drill_alias'
]);

const OPERATIONS = Object.freeze({
  context: { tool: 'campaigns_get_scope', label: 'Checking campaign access' },
  sources: { tool: 'campaigns_get_data_sources', label: 'Checking data sources' },
  capabilities: { tool: 'campaigns_get_manifest', label: 'Reading available attribution models' },
  performance: { tool: 'campaigns_query_table', label: 'Reading campaign performance' },
  attribution_comparison: { tool: 'campaigns_query_table', label: 'Comparing attribution models' },
  summary: { tool: 'campaigns_get_summary', label: 'Summarizing campaign performance' },
  trend: { tool: 'campaigns_get_daily_trend', label: 'Reading daily performance trends' },
  mapping_health: { tool: 'campaigns_get_mapping_status', label: 'Checking mapping coverage' },
  mapping_candidates: { tool: 'campaigns_preview_mapping_candidates', label: 'Reviewing exact mapping candidates' },
  evidence: { tool: 'campaigns_query_evidence', label: 'Reviewing attribution evidence' },
  attribution_log: { tool: 'campaigns_attribution_log_query', label: 'Reading the attribution log' },
  journey: { tool: 'campaigns_get_journey', label: 'Tracing an order journey' },
  order_comparison: { tool: 'campaigns_get_order_attribution_comparison', label: 'Comparing order attribution' },
  diagnostics: { tool: 'campaigns_get_pixel_diagnostics', label: 'Checking first-party data quality' },
  blended: { tool: 'campaigns_get_blended_performance', label: 'Comparing blended campaign performance' }
});
const READ_NAMES = Object.freeze(Array.from(new Set(Object.values(OPERATIONS).map((operation) => operation.tool))));

function cleanError(error) {
  return String(error?.message || error || 'Campaign data read failed')
    .replace(/csk_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .slice(0, 500);
}

function decodeToolResult(result) {
  const text = result?.content?.find((item) => item?.type === 'text' && typeof item.text === 'string')?.text;
  if (!text) return result?.structuredContent ?? result ?? null;
  try { return JSON.parse(text); } catch { return text; }
}

function activityDetail(args = {}) {
  const parts = [];
  if (args.model_key) parts.push(String(args.model_key).replaceAll('_', ' '));
  if (args.start_date && args.end_date) parts.push(`${args.start_date} → ${args.end_date}`);
  if (args.level) parts.push(String(args.level));
  if (args.platform) parts.push(String(args.platform).replaceAll('_', ' '));
  if (args.page) parts.push(`page ${args.page}`);
  return parts.length ? parts.join(' · ') : 'Credential-scoped read';
}

class CampaignClient {
  constructor({ token, endpoint, store, fetchImpl = fetch }) {
    this.token = String(token || '').trim();
    this.endpoint = String(endpoint || DEFAULT_ENDPOINT).trim();
    this.store = store;
    this.fetch = fetchImpl;
  }

  configured() { return Boolean(this.token); }

  async rpc(method, params = {}) {
    if (!this.token) throw new Error('Read-only Campaigns access is not configured for this app backend.');
    const response = await this.fetch(this.endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) throw new Error(body?.error?.message || `Campaigns API returned HTTP ${response.status}`);
    return body.result;
  }

  async verifyReadOnly() {
    const result = await this.rpc('tools/list');
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const missingReads = READ_NAMES.filter((name) => !byName.has(name));
    const unsafeReads = READ_NAMES.filter((name) => byName.get(name)?.annotations?.readOnlyHint !== true);
    const campaignTools = tools.filter((tool) => String(tool.name || '').startsWith('campaigns_'));
    if (missingReads.length) throw new Error('The configured credential is missing required Campaigns read access.');
    if (unsafeReads.length) throw new Error('A required Campaigns operation is not marked read-only.');
    const exposedWrites = WRITE_NAMES.filter((name) => byName.has(name));
    return {
      campaign_tool_count: campaignTools.length,
      app_read_only: true,
      allowed_read_operation_count: READ_NAMES.length,
      credential_write_operations_visible: exposedWrites.length
    };
  }

  async read(operation, args = {}, reportId = null) {
    const definition = OPERATIONS[operation];
    if (!definition) throw new Error('Unsupported report analysis operation.');
    if (WRITE_NAMES.includes(definition.tool)) throw new Error('Production writes are forbidden.');
    const started = Date.now();
    const callId = crypto.randomUUID();
    const context = activityDetail(args);
    const base = { call_id: callId, report_id: reportId, status: 'running', operation, title: definition.label, detail: `${context} · API call running` };
    this.store.upsertActivity(base);
    try {
      const result = await this.rpc('tools/call', { name: definition.tool, arguments: args && typeof args === 'object' ? args : {} });
      if (result?.isError) {
        const data = decodeToolResult(result);
        throw new Error(data?.error?.message || data?.error || data?.message || `${definition.label} failed`);
      }
      const data = decodeToolResult(result);
      const receipt = data?.read_receipt || data?.receipt || null;
      this.store.upsertActivity({ ...base, status: 'success', detail: `${context} · API call complete`, duration_ms: Date.now() - started, receipt_fingerprint: receipt?.response_fingerprint || receipt?.request_hash || null });
      return { operation, data, receipt, duration_ms: Date.now() - started };
    } catch (error) {
      const message = cleanError(error);
      this.store.upsertActivity({ ...base, status: 'failed', detail: message, duration_ms: Date.now() - started });
      throw new Error(message);
    }
  }
}

module.exports = { CampaignClient, OPERATIONS, READ_NAMES, WRITE_NAMES, cleanError, decodeToolResult, activityDetail };
