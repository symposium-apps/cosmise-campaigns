# Cosmise Campaign Reports agent contract

This app is an independent, read-only Campaigns reporting workspace. It does not use or expose any dashboard-building API.

## Hard boundaries

- Use only this app's local `/mcp` tools.
- Production Campaigns calls are private backend implementation details and must never appear in local `tools/list`.
- Never request, print, persist, or send the Cosmise credential to the browser, reports, tasks, activity, or chat.
- The configured credential may have broader organisation scope, but this app's production access is a fixed read-only operation allowlist. Never attempt mappings, merges, extraction-rule changes, aliases, or any other production mutation.
- Start a report before reading data. Save a report only from facts actually returned by this app.
- Label observed facts, calculations, interpretation, recommendations, scope, and limitations honestly.

## Normal workflow

1. `campaign_reports_get_bootstrap`
2. `campaign_reports_get_state`
3. `campaign_reports_start`
4. Use the bounded read operations needed for the question.
5. `campaign_reports_save_markdown` with the report's current revision.
6. `campaign_reports_validate`
7. `campaign_reports_complete`
8. Share only with `campaign_reports_share` and `confirm=true` after the user asks.

The app automatically records safe running/success/failure activity around every private production read. Do not duplicate those events manually.
