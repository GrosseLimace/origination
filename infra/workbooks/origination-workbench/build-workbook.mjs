// Generates origination-workbench.workbook.json.
//
// The workbook body is a Notebook/1.0 document whose ARM-query items carry a second JSON document
// embedded as a string. Hand-escaping that is error-prone, so this script builds the object graph and
// serialises it once. Run it after editing, then commit the JSON:
//
//     node infra/workbooks/origination-workbench/build-workbook.mjs
//
// If you instead edit the workbook in the portal (Advanced Editor), paste the result over the JSON file
// and treat THIS script as stale until it is updated to match — the JSON file is what gets deployed.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TENANT = '1521f999-f722-4a4f-9747-166f93e9b0d1';
const PORTAL = `https://portal.azure.com/#@${TENANT}/resource`;
const REPO = 'https://scoular.ghe.com/IT/origination';

let n = 0;
const name = (p) => `${p} - ${n++}`;

// Stable ids so re-running the generator does not churn the committed file.
let idSeed = 0;
const stableId = () => `00000000-0000-4000-8000-${String(++idSeed).padStart(12, '0')}`;

// ---------- item helpers ----------
const markdown = (json) => ({ type: 1, content: { json }, name: name('text') });

const argParam = (pname, label, query, extra = {}) => ({
  id: stableId(),
  version: 'KqlParameterItem/1.0',
  name: pname,
  label,
  type: 2,
  isRequired: true,
  query,
  crossComponentResources: ['{Subscriptions}'],
  typeSettings: { additionalResourceOptions: [], showDefault: false },
  queryType: 1,
  resourceType: 'microsoft.resourcegraph/resources',
  ...extra,
});

// Derived parameters: hidden in reading mode, visible in edit mode for debugging.
const hidden = (pname, query) => argParam(pname, pname, query, { isHiddenWhenLocked: true });

const thresholds = (columnMatch, grid) => ({
  columnMatch,
  formatter: 18,
  formatOptions: { thresholdsOptions: 'icons', thresholdsGrid: grid },
});

const linkFormatter = (columnMatch) => ({
  columnMatch,
  formatter: 7,
  formatOptions: { linkTarget: 'Url', linkIsContextBlade: false },
});

const armItem = (title, path, apiVersion, columns, opts = {}) => ({
  type: 3,
  content: {
    version: 'KqlItem/1.0',
    query: JSON.stringify({
      version: 'ARMEndpoint/1.0',
      data: null,
      headers: [],
      method: 'GET',
      path,
      urlParams: [{ key: 'api-version', value: apiVersion }, ...(opts.urlParams ?? [])],
      batchDisabled: false,
      transformers: [
        {
          type: 'jsonpath',
          settings: {
            tablePath: opts.tablePath ?? '$.value',
            columns: columns.map(([p, id, columnType]) => ({
              path: p,
              columnid: id,
              ...(columnType ? { columnType } : {}),
            })),
          },
        },
      ],
    }),
    size: opts.size ?? 0,
    title,
    noDataMessage: opts.noDataMessage,
    queryType: 12,
    visualization: 'table',
    gridSettings: opts.gridSettings,
  },
  customWidth: opts.customWidth,
  name: name('arm'),
});

const kqlItem = (title, query, opts = {}) => ({
  type: 3,
  content: {
    version: 'KqlItem/1.0',
    query,
    size: opts.size ?? 0,
    title,
    noDataMessage: opts.noDataMessage,
    timeContextFromParameter: 'TimeRange',
    queryType: 0,
    resourceType: 'microsoft.insights/components',
    crossComponentResources: ['{AppInsights}'],
    visualization: 'table',
    gridSettings: opts.gridSettings,
  },
  customWidth: opts.customWidth,
  name: name('kql'),
});

const argItem = (title, query, opts = {}) => ({
  type: 3,
  content: {
    version: 'KqlItem/1.0',
    query,
    size: opts.size ?? 0,
    title,
    noDataMessage: opts.noDataMessage,
    queryType: 1,
    resourceType: 'microsoft.resourcegraph/resources',
    crossComponentResources: ['{Subscriptions}'],
    visualization: 'table',
    gridSettings: opts.gridSettings,
  },
  customWidth: opts.customWidth,
  name: name('arg'),
});

// ---------- parameters ----------
const parameters = {
  type: 9,
  content: {
    version: 'KqlParameterItem/1.0',
    crossComponentResources: ['value::all'],
    parameters: [
      {
        id: stableId(),
        version: 'KqlParameterItem/1.0',
        name: 'Subscriptions',
        label: 'Subscriptions',
        type: 6,
        isRequired: true,
        multiSelect: true,
        quote: "'",
        delimiter: ',',
        typeSettings: { additionalResourceOptions: ['value::all'], includeAll: true, showDefault: false },
        defaultValue: 'value::all',
        isHiddenWhenLocked: true,
      },
      argParam(
        'Environment',
        'Environment',
        // Value is the web app's resource id; everything else is derived from it.
        // Production sorts first so it is the default whenever the reader can see it.
        [
          'resources',
          "| where type =~ 'microsoft.web/sites' and name startswith 'app-origination' and name endswith '-eus'",
          "| extend label = case(name endswith '-dev-eus', 'Dev', name endswith '-qa-eus', 'QA', 'Production')",
          "| extend sortKey = case(label == 'Production', 0, label == 'QA', 1, 2)",
          '| project value = id, label, sortKey',
          '| order by sortKey asc',
        ].join('\n'),
      ),
      {
        id: stableId(),
        version: 'KqlParameterItem/1.0',
        name: 'TimeRange',
        label: 'Time range',
        type: 4,
        isRequired: true,
        value: { durationMs: 604800000 },
        typeSettings: {
          selectableValues: [
            { durationMs: 3600000 },
            { durationMs: 14400000 },
            { durationMs: 43200000 },
            { durationMs: 86400000 },
            { durationMs: 259200000 },
            { durationMs: 604800000 },
            { durationMs: 1209600000 },
            { durationMs: 2592000000 },
          ],
          allowCustom: true,
        },
      },
      hidden(
        'ResourceGroup',
        "resources | where id =~ '{Environment}' | project value = resourceGroup, label = resourceGroup, selected = true",
      ),
      hidden(
        'AppUrl',
        "resources | where id =~ '{Environment}' | project value = case(name endswith '-dev-eus', 'https://origination-dev.scoular.com', name endswith '-qa-eus', 'https://origination-qa.scoular.com', 'https://origination.scoular.com'), label = name, selected = true",
      ),
      hidden(
        'AppInsights',
        "resources | where type =~ 'microsoft.insights/components' and resourceGroup =~ '{ResourceGroup}' | project value = id, label = name, selected = true",
      ),
      hidden(
        'DailyRecap',
        "resources | where type =~ 'microsoft.logic/workflows' and resourceGroup =~ '{ResourceGroup}' and name contains 'notes-daily-recap' | project value = id, label = name, selected = true",
      ),
      hidden(
        'InstantShare',
        "resources | where type =~ 'microsoft.logic/workflows' and resourceGroup =~ '{ResourceGroup}' and name contains 'instant-share-note' | project value = id, label = name, selected = true",
      ),
      hidden(
        'KeyVault',
        "resources | where type =~ 'microsoft.keyvault/vaults' and resourceGroup =~ '{ResourceGroup}' | project value = id, label = name, selected = true",
      ),
    ],
    style: 'pills',
    queryType: 1,
    resourceType: 'microsoft.resourcegraph/resources',
  },
  name: name('parameters'),
};

// ---------- shared formatters ----------
const deployStatus = thresholds('Status', [
  { operator: '==', thresholdValue: '4', representation: 'success', text: 'Succeeded' },
  { operator: '==', thresholdValue: '3', representation: 'failed', text: 'Failed' },
  { operator: '==', thresholdValue: '0', representation: 'pending', text: 'Pending' },
  { operator: 'Default', thresholdValue: null, representation: 'pending', text: 'In progress ({0})' },
]);

const runStatus = thresholds('Status', [
  { operator: '==', thresholdValue: 'Succeeded', representation: 'success', text: '{0}{1}' },
  { operator: '==', thresholdValue: 'Failed', representation: 'failed', text: '{0}{1}' },
  { operator: '==', thresholdValue: 'Cancelled', representation: 'cancelled', text: '{0}{1}' },
  { operator: '==', thresholdValue: 'Running', representation: 'pending', text: '{0}{1}' },
  { operator: 'Default', thresholdValue: null, representation: 'unknown', text: '{0}{1}' },
]);

const outcomeStatus = thresholds('Outcome', [
  { operator: '==', thresholdValue: 'Completed', representation: 'success', text: '{0}{1}' },
  { operator: '==', thresholdValue: 'Failed', representation: 'failed', text: '{0}{1}' },
  { operator: 'Default', thresholdValue: null, representation: 'warning', text: '{0}{1}' },
]);

const severityStatus = thresholds('Severity', [
  { operator: '==', thresholdValue: 'Sev0', representation: 'critical', text: '{0}{1}' },
  { operator: '==', thresholdValue: 'Sev1', representation: 'failed', text: '{0}{1}' },
  { operator: '==', thresholdValue: 'Sev2', representation: 'warning', text: '{0}{1}' },
  { operator: 'Default', thresholdValue: null, representation: 'info', text: '{0}{1}' },
]);

const logicAppRunColumns = [
  ['$.properties.startTime', 'Started (UTC)', 'datetime'],
  ['$.properties.endTime', 'Finished (UTC)', 'datetime'],
  ['$.properties.status', 'Status'],
  ['$.properties.trigger.name', 'Trigger'],
  ['$.properties.error.message', 'Error'],
  ['$.name', 'Run'],
];

// ---------- items ----------
const items = [
  markdown(
    [
      '## Origination Workbench — Operations',
      '',
      'One place for the things App Insights and the app do not show on their own: what is deployed where, whether the scheduled jobs and Logic Apps ran, which alerts are open, and how the integrations are behaving. ',
      'Standard telemetry (failures, performance, live metrics, logs) and adoption numbers (the in-app Usage Dashboard) are **linked**, not copied.',
    ].join('\n'),
  ),
  parameters,

  // ----- Environment at a glance -----
  armItem(
    'Environment',
    '{Environment}',
    '2023-12-01',
    [
      ['$.name', 'Web app'],
      ['$.properties.state', 'State'],
      ['$.properties.siteConfig.linuxFxVersion', 'Runtime'],
      ['$.properties.lastModifiedTimeUtc', 'Config last modified (UTC)', 'datetime'],
      ['$.properties.httpsOnly', 'HTTPS only'],
      ['$.properties.defaultHostName', 'Default host'],
    ],
    {
      tablePath: '$',
      customWidth: '50',
      gridSettings: {
        formatters: [
          thresholds('State', [
            { operator: '==', thresholdValue: 'Running', representation: 'success', text: '{0}{1}' },
            { operator: 'Default', thresholdValue: null, representation: 'failed', text: '{0}{1}' },
          ]),
        ],
      },
    },
  ),
  argItem(
    'Alerts (this environment, last 30 days)',
    [
      'alertsmanagementresources',
      "| where type =~ 'microsoft.alertsmanagement/alerts'",
      "| where resourceGroup =~ '{ResourceGroup}'",
      '| extend Fired = todatetime(properties.essentials.startDateTime),',
      '         Severity = tostring(properties.essentials.severity),',
      '         Condition = tostring(properties.essentials.monitorCondition),',
      '         State = tostring(properties.essentials.alertState),',
      '         Target = tostring(properties.essentials.targetResourceName),',
      '         Signal = tostring(properties.essentials.signalType)',
      '| project Fired, Alert = name, Severity, Condition, State, Target, Signal',
      '| order by Fired desc',
    ].join('\n'),
    {
      customWidth: '50',
      noDataMessage: 'No alerts fired in the last 30 days.',
      gridSettings: {
        formatters: [
          severityStatus,
          thresholds('Condition', [
            { operator: '==', thresholdValue: 'Fired', representation: 'failed', text: '{0}{1}' },
            { operator: '==', thresholdValue: 'Resolved', representation: 'success', text: '{0}{1}' },
            { operator: 'Default', thresholdValue: null, representation: 'unknown', text: '{0}{1}' },
          ]),
        ],
      },
    },
  ),

  // ----- Deployments -----
  armItem(
    'App deployments (newest first)',
    '{Environment}/deployments',
    '2023-12-01',
    [
      ['$.properties.start_time', 'Started (UTC)', 'datetime'],
      ['$.properties.end_time', 'Finished (UTC)', 'datetime'],
      ['$.properties.status', 'Status'],
      ['$.properties.active', 'Active'],
      ['$.properties.deployer', 'Deployer'],
      ['$.properties.message', 'Message'],
      ['$.properties.log_url', 'Log'],
    ],
    {
      noDataMessage: 'No deployments recorded for this web app.',
      gridSettings: {
        formatters: [
          deployStatus,
          thresholds('Active', [
            { operator: '==', thresholdValue: 'true', representation: 'success', text: 'Live' },
            { operator: 'Default', thresholdValue: null, representation: 'Blank', text: '' },
          ]),
          linkFormatter('Log'),
        ],
        sortBy: [{ itemKey: 'Started (UTC)', sortOrder: 2 }],
      },
    },
  ),
  markdown(
    `Deployments come from the GitHub Actions deploy workflows ([Dev](${REPO}/actions/workflows/deploy-dev.yml) · [QA](${REPO}/actions/workflows/deploy-qa.yml) · [PROD](${REPO}/actions/workflows/deploy-prod.yml)). ` +
      'The commit and build number running right now are shown in the app under the profile menu, which reads `/api/version`.',
  ),

  // ----- Logic Apps -----
  armItem('Daily Digest Logic App — recent runs', '{DailyRecap}/runs', '2016-06-01', logicAppRunColumns, {
    urlParams: [{ key: '$top', value: '20' }],
    customWidth: '50',
    noDataMessage: 'No runs found. If this environment has no Daily Digest Logic App the query has nothing to read.',
    gridSettings: { formatters: [runStatus] },
  }),
  armItem('Instant Share Logic App — recent runs', '{InstantShare}/runs', '2016-06-01', logicAppRunColumns, {
    urlParams: [{ key: '$top', value: '20' }],
    customWidth: '50',
    noDataMessage: 'No runs found. If this environment has no Instant Share Logic App the query has nothing to read.',
    gridSettings: { formatters: [runStatus] },
  }),
  markdown(
    `Open run history in the portal: [Daily Digest](${PORTAL}{DailyRecap}/overview) · [Instant Share](${PORTAL}{InstantShare}/overview). ` +
      `Before resubmitting a Daily Digest run, read section E4 of the [outage recovery playbook](${REPO}/blob/main/docs/operations/OUTAGE-RECOVERY-PLAYBOOK.md).`,
  ),

  // ----- Background jobs -----
  kqlItem(
    'CustomerSync runs (the mass-deactivation guard)',
    [
      'traces',
      '| where timestamp {TimeRange}',
      '| where message startswith "CustomerSync completed" or (message has "CustomerSync" and severityLevel >= 3)',
      '| parse message with "CustomerSync completed in " ElapsedMs:long " ms. Customers: " CustInserted:long " inserted, " CustUpdated:long " updated, " CustReactivated:long " reactivated, " CustDeactivated:long " deactivated. TradeUnits: " TuInserted:long " inserted, " TuUpdated:long " updated, " TuDeactivated:long " deactivated. " *',
      '| project timestamp,',
      '          Outcome = iff(severityLevel >= 3, "Failed", "Completed"),',
      '          ElapsedS = round(ElapsedMs / 1000.0, 1),',
      '          CustInserted, CustUpdated, CustReactivated, CustDeactivated,',
      '          TuInserted, TuUpdated, TuDeactivated,',
      '          Detail = iff(severityLevel >= 3, message, "")',
      '| order by timestamp desc',
    ].join('\n'),
    {
      noDataMessage:
        'No CustomerSync completions in this range. The job runs once at startup and once a day (CustomerSync:RunAtTimeUtc). If it ran and still shows nothing, Information-level traces are not reaching App Insights — see the outage playbook, A4.',
      gridSettings: {
        formatters: [
          outcomeStatus,
          thresholds('CustDeactivated', [
            { operator: '>', thresholdValue: '100', representation: 'critical', text: '{0}{1}' },
            { operator: '>', thresholdValue: '20', representation: 'warning', text: '{0}{1}' },
            { operator: 'Default', thresholdValue: null, representation: 'Blank', text: '{0}{1}' },
          ]),
          thresholds('TuDeactivated', [
            { operator: '>', thresholdValue: '200', representation: 'critical', text: '{0}{1}' },
            { operator: '>', thresholdValue: '50', representation: 'warning', text: '{0}{1}' },
            { operator: 'Default', thresholdValue: null, representation: 'Blank', text: '{0}{1}' },
          ]),
        ],
      },
    },
  ),
  kqlItem(
    'Other background jobs (usage rollups, retention, CTRM keep-warm)',
    [
      'traces',
      '| where timestamp {TimeRange}',
      '| where message startswith "Aggregation cycle completed"',
      '     or message startswith "Aggregated weekly logins"',
      '     or message startswith "Refreshed trade unit snapshot"',
      '     or message startswith "Failed to refresh trade unit snapshot"',
      '     or message startswith "Retention cleanup"',
      '     or message startswith "Error during aggregation cycle"',
      '     or message startswith "CTRM keep-warm: maintained"',
      '     or (message startswith "CTRM keep-warm" and severityLevel >= 2)',
      '| extend Job = case(message startswith "CTRM keep-warm", "CTRM keep-warm",',
      '                    message startswith "Retention cleanup", "Retention cleanup",',
      '                    "Usage rollups")',
      '| extend Outcome = case(severityLevel >= 3, "Failed", severityLevel == 2, "Warning", "Completed")',
      '| project timestamp, Job, Outcome, Message = message',
      '| order by timestamp desc',
      '| take 100',
    ].join('\n'),
    {
      noDataMessage:
        'No job completions in this range. Usage rollups run hourly; CTRM keep-warm runs continuously while CTRM is enabled.',
      gridSettings: {
        formatters: [outcomeStatus, { columnMatch: 'Message', formatter: 0, formatOptions: { customColumnWidthSetting: '60%' } }],
      },
    },
  ),

  // ----- Integrations -----
  kqlItem(
    'Integrations — calls, failure rate and latency in the selected range',
    [
      'dependencies',
      '| where timestamp {TimeRange}',
      '| extend Integration = case(',
      '    type == "SQL" and target has "ODS", "ODS (SQL, read-only views)",',
      '    type == "SQL" and target has "Origination", "Origination DB (SQL)",',
      '    type == "SQL" and target has "TradeUnitPreferences", "Trade Unit Preferences (SQL)",',
      '    type == "SQL", strcat("SQL: ", target),',
      '    name has "graphql" or target has "api.scoular.com" or target has "apiqa.scoular.com", "CTRM GraphQL (Scoular API gateway)",',
      '    target has "graph.microsoft.com", "Microsoft Graph",',
      '    target has "vault.azure.net", "Key Vault",',
      '    target has "login.microsoftonline.com", "Entra ID",',
      '    target has "cognitiveservices.azure.com" or target has "openai.azure.com", "Azure OpenAI",',
      '    strcat(type, ": ", target))',
      '| summarize Calls = count(), Failed = countif(success == false),',
      '            P50ms = round(percentile(duration, 50)), P95ms = round(percentile(duration, 95)), MaxMs = round(max(duration)),',
      '            Last = max(timestamp) by Integration',
      '| extend FailPct = round(100.0 * Failed / Calls, 2)',
      '| project Integration, Calls, Failed, FailPct, P50ms, P95ms, MaxMs, Last',
      '| order by Calls desc',
    ].join('\n'),
    {
      noDataMessage: 'No dependency telemetry in this range.',
      gridSettings: {
        formatters: [
          thresholds('FailPct', [
            { operator: '>', thresholdValue: '5', representation: 'failed', text: '{0}%' },
            { operator: '>', thresholdValue: '1', representation: 'warning', text: '{0}%' },
            { operator: 'Default', thresholdValue: null, representation: 'success', text: '{0}%' },
          ]),
          thresholds('P95ms', [
            { operator: '>', thresholdValue: '10000', representation: 'failed', text: '{0}{1}' },
            { operator: '>', thresholdValue: '2000', representation: 'warning', text: '{0}{1}' },
            { operator: 'Default', thresholdValue: null, representation: 'Blank', text: '{0}{1}' },
          ]),
        ],
      },
    },
  ),

  // ----- Links -----
  markdown(
    [
      '### Go deeper',
      '',
      '| App Insights (this environment) | App Service | Elsewhere |',
      '|---|---|---|',
      `| [Failures](${PORTAL}{AppInsights}/failures) · [Performance](${PORTAL}{AppInsights}/performance) · [Live Metrics](${PORTAL}{AppInsights}/quickPulse) · [Logs](${PORTAL}{AppInsights}/logs) | [Overview](${PORTAL}{Environment}/appServices) · [Log stream](${PORTAL}{Environment}/logStream) · [Key Vault](${PORTAL}{KeyVault}/overview) | [Open the app]({AppUrl}) · [Usage Dashboard (adoption)]({AppUrl}/usage-dashboard) · [GitHub Actions](${REPO}/actions) · [Project board](${REPO}/projects) · [Outage playbook](${REPO}/blob/main/docs/operations/OUTAGE-RECOVERY-PLAYBOOK.md) |`,
      '',
      'Readiness probes: [/health/ready]({AppUrl}/health/ready) · [/health/live]({AppUrl}/health/live)',
    ].join('\n'),
  ),
];

const workbook = {
  version: 'Notebook/1.0',
  items,
  isLocked: false,
  fallbackResourceIds: ['Azure Monitor'],
};

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, 'origination-workbench.workbook.json');
const out = JSON.stringify(workbook, null, 2) + '\n';
writeFileSync(target, out);
console.log(`wrote ${target} (${out.length} bytes, ${items.length} items)`);
