'use strict';

const SKILL_NAME = 'using-cosmise-campaign-reports';

const AGENT_BOOTSTRAP = Object.freeze({
  purpose: 'Use the active Symposium Agent to answer campaign questions with evidence-backed reports in the profile-local, read-only Cosmise Campaigns workspace.',
  skill_setup: {
    name: SKILL_NAME,
    source: `skills/${SKILL_NAME}/SKILL.md`,
    installer: 'node scripts/install-hermes-skill.js',
    rule: 'Install or refresh the repository-owned skill in the active profile and load it before Campaign Reports work.'
  },
  product_model: {
    analyst: 'The active Symposium Agent interprets the request, clarifies material ambiguity, selects evidence, and writes the report.',
    app: 'Cosmise Campaigns owns the private connection, bounded reads, visible report state, validation, and sharing.',
    handoff: 'The user drags Cosmise Campaigns from the Symposium Dock to the Agent and asks the question in chat.',
    rule: 'Never claim the app itself is an autonomous conversational Agent.'
  },
  chat_output_contract: {
    report_is_the_answer: true,
    duplicate_analysis_in_chat: false,
    required_final_reply_template: 'Your report “<report title>” is ready in Cosmise Campaigns.',
    rule: 'Never paste findings, tables, metrics, interpretation, recommendations, or a report summary into chat. Put all substantive analysis in the app report, verify it is ready and selected, then return only the required final reply.'
  },
  invocation: {
    context_tool: 'symposium_context.get_app_agent_context',
    call_tool: 'symposium_context.call_app_tool',
    app_id: 'cosmise-campaigns',
    rule: 'Every Campaigns question and follow-up is app-first. Never guess the managed port, use direct provider tools, or call the public app URL as an Agent API.'
  },
  api_boundaries: {
    production: {
      responsibility: 'Return credential-scoped Campaigns context, performance, attribution, trend, mapping, evidence, journey, and diagnostic reads.',
      credential_owner: 'The trusted app backend process only.',
      mode: 'read',
      mutations_allowed: false
    },
    local: {
      mcp_path: '/mcp',
      state_path: '/api/state',
      bootstrap_path: '/api/agent/bootstrap',
      instructions_path: '/api/agent/instructions',
      responsibility: 'Own reports, revisions, validation, completion, selected view, safe activity, and expiring shares.'
    }
  },
  required_start: [
    'Do not answer from prior chat data, an older report, cached results, or direct provider tools.',
    'If the trusted current-message SYM_APP_PRESTART_V1 envelope has status=started, adopt its report_id and do not call campaign_reports_start again.',
    'If no prestart receipt exists, use the fallback start sequence and pass the current Symposium message_id as request_id.',
    'In the current turn, call symposium_context.get_app_agent_context with app_id=cosmise-campaigns.',
    'Immediately make campaign_reports_start the next, separate tool call. Never batch start inside execute_code, a terminal script, campaign reads, or a generated analysis program.',
    'Do not perform extended reasoning, inspect campaign data, draft analysis, or load another skill before campaign_reports_start returns a report.id.',
    'Call campaign_reports_get_bootstrap.',
    'Call campaign_reports_get_state and require runtime.backend_mcp_configured=true and connection.state=ready.',
    'If unavailable, tell the operator to open Connections, synchronize Cosmise, and restart this app. Never request the credential.',
    'Identify missing dates, platform/campaign scope, objective, comparison, attribution model, and decision context.',
    'Ask one concise clarifying question when missing scope would materially change the answer.',
    'Use the user question and a provisional title to initialize immediately; clarification may refine scope after the report is visible. Retain the new report.id.'
  ],
  investigation_recipes: {
    performance_review: ['campaign_reports_read_context', 'campaign_reports_read_capabilities', 'campaign_reports_read_performance', 'campaign_reports_read_trend when movement matters'],
    attribution_comparison: ['campaign_reports_read_context', 'campaign_reports_read_capabilities', 'campaign_reports_compare_attribution'],
    tracking_or_mapping: ['campaign_reports_read_context', 'campaign_reports_read_mapping_health', 'campaign_reports_read_diagnostics'],
    campaign_deep_dive: ['campaign_reports_read_context', 'campaign_reports_read_performance', 'campaign_reports_read_evidence', 'campaign_reports_read_journey only when authorized and necessary'],
    change_investigation: ['campaign_reports_read_context', 'comparable performance windows', 'campaign_reports_read_trend', 'campaign_reports_read_evidence when needed']
  },
  report_rules: [
    'Use only reads needed for the actual question; do not mechanically run every tool.',
    'Derive date, currency, platform, level, model, and cohort from authoritative context or state explicit assumptions.',
    'Separate observed facts, calculations, interpretation, recommendations, and limitations.',
    'Do not infer causality or incrementality from attribution allocation.',
    'Do not call total-credit outputs deduplicated revenue or ROAS.',
    'Do not recommend budget movement from one model when ranking is model-sensitive.',
    'Use evidence and journey reads before making a specific tracking or campaign-mechanism claim.',
    'Never include credentials, authorization material, raw upstream envelopes, or hidden identifiers.',
    'Keep all production behavior read-only.'
  ],
  completion: [
    'Save with campaign_reports_save_markdown using the current revision.',
    'Call campaign_reports_validate and repair every validation error.',
    'Call campaign_reports_complete only after validation passes.',
    'Call campaign_reports_set_view with the completed report ID.',
    'Read state again and verify the new report is ready and selected.',
    'Reply only with a short handoff to the app. The report is the answer and must not be duplicated in chat.',
    'Do not repeat any report content in chat. Return only the unique title-bearing handoff supplied by campaign_reports_set_view.',
    'Share only after explicit user authorization, with confirm=true and a bounded expiration.'
  ],
  recovery_message: 'Drag the Cosmise Campaigns app from the Dock to the Agent to ask for help if nothing is happening or the report is not being viewed.'
});

const AGENT_INSTRUCTIONS = [
  'CHAT OUTPUT CONTRACT: The app report is the complete answer. Never put findings, metrics, tables, interpretation, recommendations, or a report summary in chat.',
  `REQUIRED SKILL: run node scripts/install-hermes-skill.js in the app repository, then load ${SKILL_NAME}.`,
  'APP-FIRST EXECUTION GATE: every Campaigns question and follow-up requires a new report in the current turn. Never answer from prior chat data, an older report, cached results, or direct provider tools.',
  'IMMEDIATE START: after loading the required skill, call symposium_context.get_app_agent_context, then make campaign_reports_start the next standalone symposium_context.call_app_tool call. Never batch start inside execute_code, terminal, reads, or a generated program.',
  'Do not perform extended reasoning, inspect campaign data, draft analysis, or load another skill before campaign_reports_start returns a report.id. Use a provisional title; clarification can follow visible initialization.',
  'Call every later local operation through symposium_context.call_app_tool. Never guess the managed port.',
  'Call campaign_reports_get_bootstrap and campaign_reports_get_state. Proceed only when the private read-only connection is ready.',
  'Treat a Dock-to-Agent request as tailored analysis. Identify missing dates, scope, objective, and attribution context; clarify when ambiguity changes the answer.',
  'Start one visible report immediately, retain its report.id, then use only the bounded reads needed for the question.',
  'Use evidence and journey reads before specific mechanism or tracking claims. Attribution allocation is not causal incrementality.',
  'Write observed facts, calculations, interpretation, recommendations, scope, and limitations separately. Keep production strictly read-only.',
  'Save with the current revision, validate, repair errors, complete, select the report, then verify the new report is ready and visible.',
  'The report is the answer. Reply only with a short handoff to Cosmise Campaigns; do not duplicate tables or analysis in chat.',
  'After ready-and-selected verification, return exactly the title-bearing reply_exactly value supplied by campaign_reports_set_view and nothing else.',
  'Create an expiring snapshot only after explicit user authorization.'
].join('\n');

module.exports = { AGENT_BOOTSTRAP, AGENT_INSTRUCTIONS, SKILL_NAME };
