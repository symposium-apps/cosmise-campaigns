'use strict';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const DEFAULT_MODELS = ['last_click_client','first_click_client','total_credit_client','linear','position_based','time_decay'];

function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function money(value) { return `$${number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function decimal(value) { return number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function tableText(value) { return String(value || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim(); }
function dateIso(date) { return date.toISOString().slice(0, 10); }
function formatDate(date) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date); }

function dateRangeFromQuestion(question, now = new Date()) {
  const text = String(question || '').toLowerCase();
  const explicit = text.match(/(20\d{2}-\d{2}-\d{2})\D{1,30}(20\d{2}-\d{2}-\d{2})/);
  if (explicit) return { start_date: explicit[1], end_date: explicit[2], label: `${explicit[1]} to ${explicit[2]}` };
  for (let month = 0; month < MONTHS.length; month += 1) {
    const match = text.match(new RegExp(`\\b${MONTHS[month]}\\s+(20\\d{2})\\b`));
    if (!match) continue;
    const year = Number(match[1]);
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return { start_date: dateIso(start), end_date: dateIso(end), label: `${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)} ${year}` };
  }
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start_date: dateIso(first), end_date: dateIso(last), label: `${MONTHS[first.getUTCMonth()][0].toUpperCase()}${MONTHS[first.getUTCMonth()].slice(1)} ${first.getUTCFullYear()}`, assumed: true };
}

function selectModels(capabilityRead, question = '') {
  const data = capabilityRead?.data || capabilityRead || {};
  const available = new Map((Array.isArray(data.models) ? data.models : []).map((model) => [model.key, model]));
  const wantsAll = /\b(all|every|available)\b.{0,28}\battribution models?\b|\battribution models?\b.{0,28}\b(all|every|available)\b/i.test(String(question || ''));
  const selected = wantsAll && available.size ? [...available.keys()] : DEFAULT_MODELS.filter((key) => !available.size || available.has(key));
  return selected.map((key) => ({ key, label: available.get(key)?.label || ({ last_click_client:'Last click', first_click_client:'First click', total_credit_client:'Total credit', linear:'Linear', position_based:'Position based', time_decay:'Time decay' }[key] || key) }));
}

function isTotalCredit(model) { return String(model?.key || '').startsWith('total_credit'); }
function isComparableRankingModel(model) { return !isTotalCredit(model) && !/^first_(meta|google)_/.test(String(model?.key || '')) && model?.key !== 'upsell_clicks'; }

function rowsFor(result) { return Array.isArray(result?.data?.rows) ? result.data.rows : []; }
function totalsFor(result) { return result?.data?.totals || {}; }
function rowRevenue(row) { return number(row?.display_revenue ?? row?.revenue); }
function rowRoas(row) { return number(row?.display_roas ?? row?.roas); }
function rowOrders(row) { return number(row?.orders ?? row?.conversions); }
function rowName(row) { return String(row?.display_name || row?.name || row?.id || 'Unassigned'); }
function rowCpa(row) { const orders = rowOrders(row); return orders > 0 ? number(row?.spend) / orders : null; }

function mappingValue(payload, path, fallback = 0) {
  let value = payload;
  for (const key of path) value = value?.[key];
  return value == null ? fallback : value;
}

function buildReport({ question, range, contextRead, sourceRead, capabilityRead, models, results, mappingRead, diagnosticsRead, trendRead }) {
  const context = contextRead?.data || contextRead || {};
  const scope = context.scope || context;
  const orgName = scope.org_name || 'Campaign account';
  const currency = results[models[0]?.key]?.data?.applied?.currency || 'USD';
  const resultByModel = results;
  const baseKey = models.find((model) => model.key === 'last_click_client')?.key || models[0].key;
  const baseRows = rowsFor(resultByModel[baseKey]);
  const baseTotals = totalsFor(resultByModel[baseKey]);
  const threshold = Math.max(1000, number(baseTotals.spend) * 0.01);
  const allNames = new Set();
  for (const model of models) for (const row of rowsFor(resultByModel[model.key])) allNames.add(rowName(row));
  const byModel = Object.fromEntries(models.map((model) => [model.key, new Map(rowsFor(resultByModel[model.key]).map((row) => [rowName(row), row]))]));
  const candidates = [...allNames].filter((name) => number(byModel[baseKey].get(name)?.spend) >= threshold);
  const decisionKey = models.find((model) => model.key === 'position_based')?.key || baseKey;
  const selected = candidates.sort((a, b) => rowRoas(byModel[decisionKey].get(b)) - rowRoas(byModel[decisionKey].get(a))).slice(0, 5);
  if (!selected.length) selected.push(...baseRows.filter((row) => number(row.spend) > 0).slice(0, 5).map(rowName));

  const ranks = {};
  for (const model of models.filter(isComparableRankingModel)) {
    const ranked = candidates.slice().sort((a, b) => rowRoas(byModel[model.key].get(b)) - rowRoas(byModel[model.key].get(a)));
    ranks[model.key] = new Map(ranked.map((name, index) => [name, index + 1]));
  }
  const movement = selected.map((name) => {
    const values = Object.values(ranks).map((rank) => rank.get(name)).filter(Boolean);
    return { name, min: Math.min(...values), max: Math.max(...values), delta: Math.max(...values) - Math.min(...values) };
  }).sort((a, b) => b.delta - a.delta);

  const modelTotals = models.map((model) => {
    const totals = totalsFor(resultByModel[model.key]);
    const orders = number(totals.orders);
    return `| ${tableText(model.label)}${isTotalCredit(model) ? '*' : ''} | ${money(totals.spend)} | ${money(totals.display_revenue ?? totals.revenue)} | ${decimal(orders)} | ${number(totals.display_roas ?? totals.roas).toFixed(2)}× | ${orders ? money(number(totals.spend) / orders) : '—'} |`;
  }).join('\n');

  const comparisonModels = models.filter((model) => DEFAULT_MODELS.includes(model.key));
  const comparisonRows = selected.map((name) => {
    const spend = number(byModel[baseKey].get(name)?.spend);
    return `| ${tableText(name)} | ${money(spend)} | ${comparisonModels.map((model) => `${rowRoas(byModel[model.key].get(name)).toFixed(2)}×`).join(' | ')} |`;
  }).join('\n');
  const comparisonHeader = `| Campaign | Spend | ${comparisonModels.map((model) => `${tableText(model.label)}${isTotalCredit(model) ? '*' : ''}`).join(' | ')} |\n|---|---:|${comparisonModels.map(() => '---:').join('|')}|`;

  const details = selected.flatMap((name) => models.map((model) => {
    const row = byModel[model.key].get(name) || {};
    return `| ${tableText(name)} | ${tableText(model.label)}${isTotalCredit(model) ? '*' : ''} | ${money(row.spend)} | ${money(rowRevenue(row))} | ${decimal(rowOrders(row))} | ${rowRoas(row).toFixed(2)}× | ${rowCpa(row) == null ? '—' : money(rowCpa(row))} |`;
  })).join('\n');

  const chartRows = selected.map((name) => byModel[decisionKey].get(name) || {});
  const chart = JSON.stringify({ type: 'bar', title: `${models.find((model) => model.key === decisionKey)?.label || 'Selected-model'} ROAS — leading campaigns`, labels: selected.map((name) => tableText(name).slice(0, 42)), values: chartRows.map(rowRoas), unit: '×' });

  const mappingStatus = mappingRead?.status?.data || mappingRead?.status || {};
  const candidateData = mappingRead?.candidates?.data || mappingRead?.candidates || {};
  const counts = candidateData.status_counts || {};
  const unassignedRevenue = number(mappingStatus?.totals?.revenue_credit);
  const unassignedOrders = number(mappingStatus?.totals?.order_credit);
  const diagnostics = diagnosticsRead?.data || diagnosticsRead || {};
  const identity = Array.isArray(diagnostics.identity_coverage) ? diagnostics.identity_coverage[0] || {} : {};
  const quality = Array.isArray(diagnostics.revenue_quality) ? diagnostics.revenue_quality[0] || {} : {};
  const platformOnly = baseRows.filter((row) => row.mapping_status === 'platform_only');
  const platformOnlySpend = platformOnly.reduce((sum, row) => sum + number(row.spend), 0);
  const zeroAttributed = baseRows.filter((row) => number(row.spend) > 0 && models.every((model) => rowRevenue(byModel[model.key].get(rowName(row))) === 0));
  const zeroAttributedSpend = zeroAttributed.reduce((sum, row) => sum + number(row.spend), 0);

  const strongest = selected[0];
  const strongestRows = models.filter(isComparableRankingModel).map((model) => byModel[model.key].get(strongest));
  const strongestMin = Math.min(...strongestRows.map(rowRoas));
  const strongestMax = Math.max(...strongestRows.map(rowRoas));
  const stable = selected.slice().sort((a, b) => {
    const spread = (name) => { const values = models.filter(isComparableRankingModel).map((model) => rowRoas(byModel[model.key].get(name))); return Math.max(...values) - Math.min(...values); };
    return spread(a) - spread(b);
  })[0];
  const title = `${orgName} — ${range.label} campaign performance`;
  const queryLabel = range.assumed ? `${range.label} (previous complete month; no date was supplied)` : range.label;
  const totalRows = Math.max(...models.map((model) => number(resultByModel[model.key]?.data?.pagination?.total)));
  const proposals = number(counts.proposable);
  const conflicts = number(counts.mapping_conflict);
  const noExact = number(counts.no_exact_match);
  const zeroPurchasePercent = number(quality.purchase_count) ? number(quality.zero_value_purchases) / number(quality.purchase_count) * 100 : 0;

  const markdown = `# ${title}

## Executive answer

Within the API's highest-spend campaign cohort, **${tableText(strongest)}** was the strongest efficiency leader under the ${models.find((model) => model.key === decisionKey)?.label || decisionKey} decision view. Across non-duplicative models its ROAS ranged from **${strongestMin.toFixed(2)}× to ${strongestMax.toFixed(2)}×**. **${tableText(stable)}** showed the smallest ROAS spread among the selected leaders and is the least model-sensitive candidate for controlled budget testing.

This report compares fixed provider spend with attribution-dependent revenue, conversion credit, ROAS, and CPA. Total-credit results are shown as an assist signal and are not used as a deduplicated return metric.

## Scope

- **Question:** ${String(question || '').replace(/[<>]/g, '')}
- **Dates:** ${formatDate(new Date(`${range.start_date}T00:00:00Z`))}–${formatDate(new Date(`${range.end_date}T00:00:00Z`))}${range.assumed ? ' (automatically selected previous complete month)' : ''}
- **Account:** ${tableText(orgName)}${scope.store_hostname ? ` / ${tableText(scope.store_hostname)}` : ''}
- **Currency:** ${currency}
- **Models:** ${models.map((model) => tableText(model.label)).join(', ')}
- **Ranking cohort:** first 50 rows sorted by provider spend${totalRows ? ` from up to ${totalRows.toLocaleString('en-US')} returned campaign rows` : ''}; this is not an exhaustive low-spend ROAS ranking
- **Sources:** provider APIs for spend and delivery; first-party Campaigns analytics for attribution and diagnostics

## Model-level totals

| Model | Provider spend | Attributed revenue | Conversions / credit | ROAS | CPA |
|---|---:|---:|---:|---:|---:|
${modelTotals}

_Note: Total credit can give full credit to multiple touched campaigns. Its revenue, conversion-credit, ROAS, and CPA values are intentionally non-deduplicated._

## Leading campaigns — ROAS comparison

${comparisonHeader}
${comparisonRows}

\`\`\`campaign-chart
${chart}
\`\`\`

## Revenue, conversions, ROAS, and CPA by model

| Campaign | Model | Spend | Attributed revenue | Conversions / credit | ROAS | CPA |
|---|---|---:|---:|---:|---:|---:|
${details}

## Material ranking changes

${movement.map((item, index) => `${index + 1}. **${tableText(item.name)}** ranged from rank **#${item.min} to #${item.max}** across the non-duplicative models${item.delta >= 3 ? ', a material change that should block single-model budget decisions' : ', indicating comparatively stable placement'}.`).join('\n')}

## Tracking and mapping limitations

- The read-only mapping preview found **${proposals} exact proposals**, **${conflicts} conflicts**, and **${noExact} rows without an exact match**. No mapping was written.
- Unassigned attribution contained **${money(unassignedRevenue)} revenue** and **${decimal(unassignedOrders)} order credit** in this window.
- The highest-spend page contained **${platformOnly.length} platform-only rows** representing **${money(platformOnlySpend)} spend** without a linked first-party campaign combination.
- **${money(zeroAttributedSpend)} spend** across ${zeroAttributed.length} reviewed rows had zero attributed revenue under every selected model. This needs objective, evidence, and mapping review; it is not proof of zero incremental value.
- Identity diagnostics reported **${number(identity.client_id_coverage_percent).toFixed(2)}% client-ID coverage** and **${number(identity.customer_id_coverage_percent).toFixed(2)}% customer-ID coverage** across **${number(identity.total_events).toLocaleString('en-US')} events**.
- Of **${number(quality.purchase_count).toLocaleString('en-US')} purchase events**, **${number(quality.zero_value_purchases).toLocaleString('en-US')} (${zeroPurchasePercent.toFixed(2)}%) were zero-value**. Campaigns may classify swatch/sample events separately; validate that treatment before blending CPA decisions.

## Three recommended actions

1. **Protect and test the stable winner.** Use ${tableText(stable)} for controlled incremental budget tests, while monitoring provider spend and at least one first/last-touch plus one fractional model.
2. **Do not act on ranking-sensitive campaigns from one model.** Review campaigns with a rank swing of three or more using bounded evidence and journey reads before scaling or cutting them.
3. **Prioritize measurement cleanup.** Review exact mapping proposals and conflicts first, then investigate platform-only and zero-attributed high-spend rows. Keep all mapping changes outside this read-only app and require explicit production approval.

## Method and limitations

The automatic workflow used only the app's allowlisted, read-only local Campaigns operations. It loaded live scope and model capabilities, queried the same ${queryLabel} campaign cohort under ${models.length} models, then read mapping and pixel diagnostics before generating and validating this report. No campaign, mapping, extraction rule, alias, budget, customer, or production setting was changed.

Spend is provider-side and does not change by attribution model. Revenue and conversion credit are model outputs; fractional models can return fractional conversions. Model allocation describes observed credit rather than causal incrementality. The analysis is bounded to the highest-spend first page, and late-arriving events or future mapping changes can alter later results.
`;
  return { title, markdown, summary: { strongest, stable, threshold, selected, totalRows, currency, range } };
}

module.exports = { DEFAULT_MODELS, buildReport, dateRangeFromQuestion, selectModels, tableText };
