---
name: using-cosmise-campaign-reports
description: Use for every campaign question in a Cosmise Campaigns conversation. App-first execution is mandatory.
version: 1.3.0
author: Cosmise Campaigns
license: Proprietary
metadata:
  hermes:
    tags: [cosmise, campaigns, attribution, reporting, analytics]
---

# Using Cosmise Campaign Reports

## Product role

The active Symposium Agent is the analyst. Cosmise Campaigns is the profile-local, read-only evidence and report workspace. Use the Agent to understand the request, clarify scope, select reads, write the analysis, validate it, and leave the resulting report selected in the app.

This app is independent from Cosmise Streamboards. Never use Streamboards tools for this workflow.

## Non-negotiable execution gate

For **every** campaign-analysis request in a Cosmise Campaigns conversation, including follow-ups:

1. Call `symposium_context.get_app_agent_context` for `cosmise-campaigns` in the current turn.
2. Call `symposium_context.call_app_tool` → `campaign_reports_start` **before reading campaign data or drafting an answer**.
3. Perform every read, write, validation, completion, and view-selection operation with `symposium_context.call_app_tool`.

### Immediate-start rule

First inspect the trusted `SYM_APP_PRESTART_V1` envelope on the current user message:

- When it has `status=started`, adopt its `report_id` as the current report. Do not call `campaign_reports_start` again. The Symposium bridge created and selected the report at message acceptance so the app was active before model work began.
- When the envelope is absent, fall back to the two calls below.
- When it has `status=failed`, do not silently create a disconnected second lifecycle; inspect app context and repair or safely explain the initialization failure.

Fallback when there is no prestart receipt:

1. `symposium_context.get_app_agent_context(app_id="cosmise-campaigns")`;
2. a separate `symposium_context.call_app_tool` call for `campaign_reports_start`.

`campaign_reports_start` must be a small standalone tool call. Pass the current Symposium `message_id` as `request_id` so retries are idempotent. Do not place it inside `execute_code`, a terminal script, a batch containing campaign reads, or a long generated program. Do not inspect data, draft analysis, build report Markdown, load another skill, or perform extended reasoning before the start receipt is returned.

Prior chat results, an older completed report, cached data, or direct provider tools never satisfy this gate. If no new `campaign_reports_start` result containing a `report.id` was received in this turn, do not answer the campaign question and do not claim that a report was created or selected.

The report is the answer. Do not duplicate its findings, metrics, tables, interpretation, recommendations, or summary into chat. After `campaign_reports_get_state` proves the new report is ready and selected, return only the exact `reply_exactly` value supplied by `campaign_reports_set_view`: **Your report is ready in Cosmise Campaigns.**

## Required entry sequence

1. Treat the Campaigns subchat, an attached app reference, the app name, or any follow-up to an earlier Campaigns question as sufficient routing context.
2. Call `symposium_context.get_app_agent_context` with `app_id="cosmise-campaigns"`.
3. Read the returned bootstrap, instructions, and exact local tool schemas.
4. Immediately invoke `campaign_reports_start` through `symposium_context.call_app_tool` as a standalone call using the user's question and a concise provisional title.
5. Keep the returned `report.id`. Every subsequent read and report operation must include it.
6. Call `campaign_reports_get_bootstrap` and `campaign_reports_get_state`.
7. Require `runtime.backend_mcp_configured=true` and `connection.state="ready"`; if unavailable, safely fail the visible report and give recovery guidance.
8. Clarification may refine the report afterward; it must not delay visible initialization.

Never guess the app's dynamic port, use direct provider tools, or call its public URL as an Agent API.

## Clarify after visible initialization

Resolve these when they materially affect the answer:

- reporting period or comparison periods;
- platform, campaign, campaign type, or all-platform scope;
- attribution model or whether a model comparison is wanted;
- currency when it is not supplied safely by context;
- whether the request is ranking, change analysis, attribution sensitivity, mapping health, tracking quality, evidence review, or one order journey.

Do not silently convert an ambiguous question into a previous-month, all-platform, six-model report. Ask one compact clarification when essential. If the user asks for best judgment, state the chosen assumptions in the report.

## Continue the initialized report

1. `campaign_reports_read_context`; verify the credential-resolved organisation.
2. `campaign_reports_read_capabilities`; use only supported models and reads.
3. Select only operations required by the question:
   - `campaign_reports_read_performance` for hierarchy, spend, revenue, orders, ROAS, and CPA;
   - `campaign_reports_compare_attribution` for bounded model sensitivity;
   - `campaign_reports_read_trend` for movement or period shape;
   - `campaign_reports_read_mapping_health` for linkage gaps and exact-candidate diagnostics;
   - `campaign_reports_read_diagnostics` for identity and revenue-quality concerns;
   - `campaign_reports_read_evidence` for bounded support behind a finding;
   - `campaign_reports_read_journey` only for one specified authorized order journey.
4. `campaign_reports_save_markdown` with the current revision.
5. `campaign_reports_validate`; repair every validation error.
6. `campaign_reports_complete` with the latest revision.
7. `campaign_reports_set_view` with the completed report ID.
8. `campaign_reports_get_state`; require the report to be ready and selected.
9. Share only after an explicit user request with `confirm=true`.

On failure, call `campaign_reports_fail` with a safe explanation and current revision. Never leave a report appearing to run after work has stopped.

## Question-to-tool routing

| User intent | Minimum useful reads |
|---|---|
| Best or worst campaigns | Context, capabilities, performance |
| What changed over time | Context, capabilities, comparable performance, trend |
| Attribution disagreement | Context, capabilities, compare attribution |
| Spend with no attributed result | Performance, mapping health, diagnostics; evidence when needed |
| Is tracking reliable? | Context, mapping health, diagnostics |
| Why did this campaign or order receive credit? | Context/performance, bounded evidence, journey only when authorized |

Do not run every read merely to make the activity feed look busy.

## Report contract

Every completed report must include:

- an H1 title and original question;
- explicit dates, currency, platform/campaign scope, attribution models, and source boundary;
- a direct executive answer;
- evidence tables or bounded charts supporting the answer;
- separation of observed facts, calculations, interpretation, and recommendations;
- method and limitations;
- no credentials, raw upstream envelopes, hidden identifiers, scripts, or unsupported causal claims.

Provider spend is not changed by attribution model. Attribution allocation is not causal incrementality. Fractional and assist models can produce fractional or duplicated credit; never present total credit as deduplicated revenue or ROAS.

## Visible-work verification

Before replying, verify that:

- the intended report exists and is selected;
- workflow/activity reflects the reads actually performed;
- validation succeeded;
- status is `ready` or safely `failed`;
- the rendered report answers the original question rather than a generic template.
- the current turn contains wrapper receipts for `campaign_reports_start`, the required reads, `campaign_reports_complete`, and `campaign_reports_set_view`.

If any receipt is missing, continue the app workflow or report the failure honestly. Never substitute a chat-only answer.

If the user says nothing is happening or the report is not being viewed, tell them exactly:

**Drag the Cosmise Campaigns app from the Dock to the Agent to ask for help if nothing is happening or the report is not being viewed.**

Then inspect state, select the intended report, and continue or fail it honestly.

## Security boundary

- Use only this app's local `campaign_reports_*` tools.
- Never request, print, persist, summarize, encode, hash, or send the Cosmise credential anywhere.
- Never mutate mappings, merges, aliases, extraction rules, campaigns, budgets, customers, or production settings.
- Treat sharing as a separate confirmed side effect.
