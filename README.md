# Cosmise Campaigns

A profile-local Symposium workspace where the active Agent turns campaign questions into saved, evidence-backed Markdown reports using a private, read-only Cosmise Campaigns connection.

![Campaign Reports](assets/icon.png)

## What it does

- receives campaign-analysis work from the active Symposium Agent after the app is dragged from the Dock into chat;
- privately reads credential-scoped campaign context, performance, attribution models, trends, mapping health, evidence, journeys, and diagnostics;
- shows backend-authoritative workflow and API-call progress while analysis is running;
- writes, validates, and stores a sanitized Markdown report;
- renders bounded local charts and mobile-safe tables;
- creates expiring, revocable report snapshots only after explicit confirmation.

The browser is the report workspace, not a second conversational Agent. To begin or recover work, drag **Cosmise Campaigns** from the Dock to the Agent and ask the campaign question in chat. Public iframe requests cannot start credential-backed analysis; the Agent operates the loopback-only app MCP through SYM-Node.

The app exposes only its own `campaign_reports_*` MCP operations. Raw production Campaigns operations, authorization headers, credentials, and upstream envelopes are never exposed to the browser or local MCP catalog.

## Symposium package

The repository follows the SYM app v1 contract:

- `sym-app.json` — app identity, runtime, configuration, permissions, persistence, agent, and marketplace metadata;
- `AGENTS.md` — app-local Agent entry contract;
- `skills/using-cosmise-campaign-reports/SKILL.md` and `scripts/install-hermes-skill.js` — repository-owned profile skill and safe installer;
- `package.json` / `package-lock.json` — inferred Node install and start lifecycle;
- `server.js` — managed HTTP runtime honoring worker-provided `HOST` and `PORT`;
- `/_sym/health` — managed-runtime health check;
- `/api/agent/bootstrap` and `/mcp` — app-local agent surfaces;
- `.sym-data/` — declared private persistent state;
- `assets/` — marketplace artwork, screenshots, and third-party font notices.

SYM installs the app profile-locally under `project_files/Apps/cosmise-campaigns`, runs `npm ci`, starts it with `npm start`, and owns process stop/restart.

## Configuration

| Name | Type | Required | Purpose |
| --- | --- | --- | --- |
| `COSMISE_MCP_TOKEN` | secret | Runtime connection | Backend-only organisation-scoped Cosmise credential. |
| `COSMISE_MCP_URL` | environment | No | Defaults to `https://cosmise.com/api/mcp`. |
| `HOST` | worker environment | Managed runtime | Bind address assigned by SYM. |
| `PORT` | worker environment | Managed runtime | Port assigned by SYM. |

The server starts without the Cosmise credential and presents a connection gate. Report analysis remains unavailable until the private backend verifies the configured connection.

## Local development

```bash
npm ci
COSMISE_MCP_TOKEN=<organisation-key> npm start
```

The development fallback listens on `0.0.0.0:4318`; a managed worker overrides both `HOST` and `PORT`.

Run the complete verification suite:

```bash
npm run check
npm audit --omit=dev
```

The workflow renderer can be replayed locally at `/workflow-spec.html` without creating production data.

## Security boundaries

- The production adapter uses an exact read allowlist.
- No generic proxy or caller-selected production operation exists.
- Local report writes never mutate production Campaigns data.
- MCP is loopback-only; public browser clients cannot call it.
- Markdown is sanitized and executable markup is rejected during validation.
- Charts accept only bounded declarative `campaign-chart` JSON.
- Share snapshots require `confirm=true`, expire, and can be revoked.
- Runtime data, credentials, environment files, and dependencies are excluded from Git.

## Data

Private reports, workflow state, activity receipts, revisions, and share metadata are stored under `.sym-data/`. The manifest declares this as persistent private state so managed updates do not replace it.

## Artwork

`assets/icon.png` is the marketplace source and is byte-identical to `public/campaign-reports-icon.png`, which is used for the favicon, app shell, empty state, and build workflow. Bundled fonts are distributed under the SIL Open Font License; notices are in `assets/fonts/licenses/`.

## License

Copyright © Samos Labs. All rights reserved.
