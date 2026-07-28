# Cosmise Campaigns agent entry point

Cosmise Campaigns is the profile-local, read-only evidence and report workspace. The active Symposium Agent is the analyst: it interprets the user's campaign question, clarifies material scope, selects bounded reads, writes and validates the report, and leaves that report visible in this app.

This app is independent from Cosmise Streamboards. Never use or expose dashboard-building APIs here.

## Mandatory app-first gate

Every campaign question or follow-up in this app's conversation must create a new visible report through the wrapper in the same turn. Before drafting an answer:

1. Call `symposium_context.get_app_agent_context(app_id="cosmise-campaigns")`.
2. Call `symposium_context.call_app_tool` for `campaign_reports_start` and retain the returned `report.id`.
3. Use `symposium_context.call_app_tool` for every subsequent app operation.

Never answer from prior chat content, an old report, cached results, or direct provider Campaigns tools. Without a same-turn `campaign_reports_start` receipt, do not provide analysis and do not claim a report exists. The finished report is the answer. Never paste findings, metrics, tables, interpretation, recommendations, or summaries into chat. After ready-and-selected state is verified, the entire final reply must be exactly: **Your report is ready in Cosmise Campaigns.**

## Required first actions

1. Run `node scripts/install-hermes-skill.js` to install or refresh the repository-owned `using-cosmise-campaign-reports` skill in the active Hermes profile. The installer requires profile-scoped `HERMES_HOME` or explicit `HERMES_PROFILE`; never infer a profile from a workspace, organisation, customer, or `SYM_PROFILE_ID`.
2. Load `using-cosmise-campaign-reports`. If the current session was created before first installation, restart or begin a fresh Agent session so the skill is indexed.
3. Use `symposium_context.get_app_agent_context` with `app_id="cosmise-campaigns"`.
4. Read the returned bootstrap, MCP instructions, and local tool schemas.
5. Invoke every app operation through `symposium_context.call_app_tool`; never guess the managed port, use direct provider tools, or call the public app URL as an agent API.
6. Call `campaign_reports_get_bootstrap` and `campaign_reports_get_state` before production reads.
7. Proceed only when `runtime.backend_mcp_configured=true` and `connection.state="ready"`.

## Hard boundaries

- Use only this app's local `campaign_reports_*` tools.
- Production Campaigns calls are private backend implementation details and must never appear in local `tools/list`.
- Never request, print, persist, summarize, encode, hash, or send the Cosmise credential to the browser, reports, activity, skills, tasks, files, or chat.
- The configured credential may have broader organisation scope, but this app enforces a fixed read-only operation allowlist.
- Never attempt mappings, merges, extraction-rule changes, aliases, campaign edits, budgets, or any other production mutation.
- Start a report before reading data. Save only facts actually returned by this app.
- Label observed facts, calculations, interpretation, recommendations, scope, and limitations honestly.
- Share only after an explicit user request and `confirm=true`.

## Agent-driven workflow

1. Clarify material ambiguity in period, platform/campaign scope, attribution model, comparison, currency, or requested analysis type.
2. `campaign_reports_start` with the exact question and a concise title. This creates and selects the visible report.
3. `campaign_reports_read_context`; verify the credential-resolved organisation.
4. `campaign_reports_read_capabilities`; use only supported models and operations.
5. Select only the reads needed for the question: performance, attribution comparison, trend, mapping health, diagnostics, evidence, or one authorized journey.
6. `campaign_reports_save_markdown` with the current revision.
7. `campaign_reports_validate`; repair every validation error.
8. `campaign_reports_complete` with the latest revision.
9. `campaign_reports_set_view` with the completed report ID.
10. `campaign_reports_get_state`; require `status="ready"` and the intended `view.active_report_id` before replying.
11. Reply exactly `Your report is ready in Cosmise Campaigns.` and nothing else.

The app automatically records safe running/success/failure activity around every private production read. Do not duplicate those events manually.

## Recovery and visible handoff

If the user says nothing is happening or the report is not being viewed, tell them exactly:

**Drag the Cosmise Campaigns app from the Dock to the Agent to ask for help if nothing is happening or the report is not being viewed.**

Then read current app state, select the intended report, and continue or fail it honestly. Never leave a report visually running after the work has stopped.
