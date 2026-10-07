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
//
// Layout: a parameter bar (Environment, Time range), a tab strip, one section per tab, and an
// always-visible link list at the bottom. Every item is a small helper call so the shape stays uniform.

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

// ---------- tabs ----------
const TABS = [
  ['overview', 'Overview'],
  ['deployments', 'Deployments'],
  ['logicapps', 'Logic Apps'],
  ['jobs', 'Background jobs'],
  ['integrations', 'Integrations'],
  ['activity', 'Activity'],
];

const onTab = (tab) => ({ conditionalVisibility: { parameterName: 'Tab', comparison: 'isEqualTo', value: tab } });

// ---------- item helpers ----------
const markdown = (json, extra = {}) => ({ type: 1, content: { json }, name: name('text'), ...extra });

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

const width = (columnMatch, customColumnWidthSetting) => ({
  columnMatch,
  formatter: 0,
  formatOptions: { customColumnWidthSetting },
});

const link = (columnMatch, linkLabel) => ({
  columnMatch,
  formatter: 7,
  formatOptions: { linkTarget: 'Url', linkLabel, linkIsContextBlade: false },
});

const labels = (map) => Object.entries(map).map(([columnId, label]) => ({ columnId, label }));

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
    showRefreshButton: true,
    queryType: 12,
    visualization: 'table',
    gridSettings: opts.gridSettings,
  },
  customWidth: opts.customWidth,
  name: name('arm'),
  ...(opts.tab ? onTab(opts.tab) : {}),
});

const kqlItem = (title, query, opts = {}) => ({
  type: 3,
  content: {
    version: 'KqlItem/1.0',
    query,
    size: opts.size ?? 0,
    title,
    noDataMessage: opts.noDataMessage,
    showRefreshButton: true,
    timeContextFromParameter: 'TimeRange',
    queryType: 0,
    resourceType: 'microsoft.insights/components',
    crossComponentResources: ['{AppInsights}'],
    visualization: opts.visualization ?? 'table',
    tileSettings: opts.tileSettings,
    gridSettings: opts.gridSettings,
  },
  customWidth: opts.customWidth,
  name: name('kql'),
  ...(opts.tab ? onTab(opts.tab) : {}),
});

const argItem = (title, query, opts = {}) => ({
  type: 3,
  content: {
    version: 'KqlItem/1.0',
    query,
    size: opts.size ?? 0,
    title,
    noDataMessage: opts.noDataMessage,
    showRefreshButton: true,
    queryType: 1,
    resourceType: 'microsoft.resourcegraph/resources',
    crossComponentResources: ['{Subscriptions}'],
    visualization: 'table',
    gridSettings: opts.gridSettings,
  },
  customWidth: opts.customWidth,
  name: name('arg'),
  ...(opts.tab ? onTab(opts.tab) : {}),
});

// A titled column of links. Markdown is used rather than a LinkItem because markdown items have no
// per-item title and the parameter tokens ({AppInsights} etc.) are substituted inside markdown too.
const linkColumn = (title, links) =>
  markdown([`**${title}**`, '', ...links.map(([label, url]) => `- [${label}](${url})`)].join('\n'), { customWidth: '33' });

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
      // Set by the tab strip below; declared here so the first tab is selected on open.
      {
        id: stableId(),
        version: 'KqlParameterItem/1.0',
        name: 'Tab',
        label: 'Tab',
        type: 1,
        isRequired: true,
        value: TABS[0][0],
        isHiddenWhenLocked: true,
      },
      hidden(
        'ResourceGroup',
        "resources | where id =~ '{Environment}' | project value = resourceGroup, label = resourceGroup, selected = true",
      ),
      hidden(
        'SubscriptionId',
        "resources | where id =~ '{Environment}' | project value = subscriptionId, label = subscriptionId, selected = true",
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

const tabStrip = {
  type: 11,
  content: {
    version: 'LinkItem/1.0',
    style: 'tabs',
    links: TABS.map(([subTarget, linkLabel]) => ({
      id: stableId(),
      cellValue: 'Tab',
      linkTarget: 'parameter',
      linkLabel,
      subTarget,
      style: 'link',
    })),
  },
  name: name('tabs'),
};

// ---------- shared formatters ----------
const deployStatus = thresholds('Status', [
  { operator: '==', thresholdValue: '4', representation: 'success', text: 'Succeeded' },
  { operator: '==', thresholdValue: '3', representation: 'failed', text: 'Failed' },
  { operator: '==', thresholdValue: '0', representation: 'pending', text: 'Pending' },
  { operator: 'Default', thresholdValue: null, representation: 'pending', text: 'In progress' },
]);

const liveMarker = thresholds('Active', [
  { operator: '==', thresholdValue: 'true', representation: 'success', text: 'Live' },
  { operator: 'Default', thresholdValue: null, representation: 'Blank', text: '' },
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

const deactivatedWarning = (columnMatch, warn, critical) =>
  thresholds(columnMatch, [
    { operator: '>', thresholdValue: String(critical), representation: 'critical', text: '{0}{1}' },
    { operator: '>', thresholdValue: String(warn), representation: 'warning', text: '{0}{1}' },
    { operator: 'Default', thresholdValue: null, representation: 'Blank', text: '{0}{1}' },
  ]);

// ---------- column sets ----------
const deploymentColumns = [
  ['$.properties.start_time', 'Started', 'datetime'],
  ['$.properties.end_time', 'Finished', 'datetime'],
  ['$.properties.status', 'Status'],
  ['$.properties.active', 'Active'],
  ['$.properties.log_url', 'Log'],
];

const deploymentGrid = (rowLimit) => ({
  formatters: [
    width('Started', '22%'),
    width('Finished', '22%'),
    deployStatus,
    liveMarker,
    link('Log', 'Open log'),
  ],
  labelSettings: labels({ Active: 'Slot' }),
  sortBy: [{ itemKey: 'Started', sortOrder: 2 }],
  ...(rowLimit ? { rowLimit } : {}),
});

const logicRunColumns = [
  ['$.properties.startTime', 'Started', 'datetime'],
  ['$.properties.endTime', 'Finished', 'datetime'],
  ['$.properties.status', 'Status'],
  ['$.properties.trigger.name', 'Trigger'],
  ['$.properties.error.message', 'Error'],
];

const logicRunGrid = {
  formatters: [width('Started', '28%'), width('Finished', '28%'), runStatus, width('Trigger', '14%'), width('Error', '30%')],
};

const logicRuns = (title, idParam, top, opts) =>
  armItem(title, `{${idParam}}/runs`, '2016-06-01', logicRunColumns, {
    urlParams: [{ key: '$top', value: String(top) }],
    customWidth: '50',
    noDataMessage: 'No runs found. If this environment has no such Logic App there is nothing to read.',
    gridSettings: logicRunGrid,
    ...opts,
  });

// ---------- KQL ----------
// Job lines logged WITH an exception (LogError(ex, ...)) land in `exceptions`, not `traces`, with the
// rendered message in customDimensions.FormattedMessage. Read both so failures are not missed.
const jobEvents = [
  'union',
  '  (traces | project timestamp, severityLevel, message),',
  '  (exceptions | project timestamp, severityLevel = 3, message = coalesce(tostring(customDimensions.FormattedMessage), outerMessage))',
  '| where timestamp {TimeRange}',
].join('\n');

const customerSyncQuery = (take) =>
  [
    jobEvents,
    '| where message startswith "CustomerSync completed" or (message has "CustomerSync" and severityLevel >= 3)',
    '| parse message with "CustomerSync completed in " ElapsedMs:long " ms. Customers: " CustInserted:long " inserted, " CustUpdated:long " updated, " CustReactivated:long " reactivated, " CustDeactivated:long " deactivated. TradeUnits: " TuInserted:long " inserted, " TuUpdated:long " updated, " TuDeactivated:long " deactivated. " *',
    '| project Ran = timestamp,',
    '          Outcome = iff(severityLevel >= 3, "Failed", "Completed"),',
    '          Seconds = round(ElapsedMs / 1000.0, 1),',
    '          CustInserted, CustUpdated, CustReactivated, CustDeactivated,',
    '          TuInserted, TuUpdated, TuDeactivated,',
    '          Detail = iff(severityLevel >= 3, message, "")',
    '| order by Ran desc',
    ...(take ? [`| take ${take}`] : []),
  ].join('\n');

const customerSyncGrid = {
  formatters: [
    width('Ran', '16%'),
    outcomeStatus,
    deactivatedWarning('CustDeactivated', 20, 100),
    deactivatedWarning('TuDeactivated', 50, 200),
    width('Detail', '20%'),
  ],
  labelSettings: labels({
    CustInserted: 'Cust +',
    CustUpdated: 'Cust ~',
    CustReactivated: 'Cust back',
    CustDeactivated: 'Cust off',
    TuInserted: 'TU +',
    TuUpdated: 'TU ~',
    TuDeactivated: 'TU off',
  }),
};

const customerSyncNoData =
  'No CustomerSync completions in this range. The job runs once at startup and once a day (CustomerSync:RunAtTimeUtc). If it ran and still shows nothing, Information-level traces are not reaching App Insights — see the outage playbook, A4.';

const otherJobsQuery = [
  jobEvents,
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
  '| project Ran = timestamp, Job, Outcome, Message = message',
  '| order by Ran desc',
  '| take 100',
].join('\n');

const integrationsQuery = [
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
].join('\n');

const integrationsGrid = {
  formatters: [
    width('Integration', '28%'),
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
  labelSettings: labels({ FailPct: 'Fail %', P50ms: 'p50 ms', P95ms: 'p95 ms', MaxMs: 'max ms', Last: 'Last call' }),
};

// ---------- items ----------
const items = [
  markdown(
    'Cross-environment view of what App Insights and the app do not show on their own. Standard telemetry (failures, performance, live metrics, logs) and adoption (the in-app Usage Dashboard) are linked at the bottom, not copied here.',
  ),
  parameters,
  tabStrip,

  // ===== Overview =====
  argItem(
    'Web app',
    [
      'resources',
      "| where id =~ '{Environment}'",
      '| project Name = name, State = tostring(properties.state), Runtime = tostring(properties.siteConfig.linuxFxVersion),',
      '          ConfigChanged = todatetime(properties.lastModifiedTimeUtc)',
    ].join('\n'),
    {
      tab: 'overview',
      customWidth: '50',
      gridSettings: {
        formatters: [
          thresholds('State', [
            { operator: '==', thresholdValue: 'Running', representation: 'success', text: '{0}{1}' },
            { operator: 'Default', thresholdValue: null, representation: 'failed', text: '{0}{1}' },
          ]),
        ],
        labelSettings: labels({ ConfigChanged: 'Config changed' }),
      },
    },
  ),
  argItem(
    'TLS certificate',
    [
      'resources',
      "| where type =~ 'microsoft.web/certificates' and resourceGroup =~ '{ResourceGroup}'",
      '| extend Expires = todatetime(properties.expirationDate)',
      "| extend DaysLeft = datetime_diff('day', Expires, now())",
      '| project Hosts = strcat_array(properties.hostNames, ", "), Issuer = tostring(properties.issuer), Expires, DaysLeft',
      '| order by Expires asc',
    ].join('\n'),
    {
      tab: 'overview',
      customWidth: '50',
      noDataMessage: 'No App Service certificate in this resource group.',
      gridSettings: {
        formatters: [
          thresholds('DaysLeft', [
            { operator: '<', thresholdValue: '7', representation: 'critical', text: '{0} days' },
            { operator: '<', thresholdValue: '21', representation: 'warning', text: '{0} days' },
            { operator: 'Default', thresholdValue: null, representation: 'success', text: '{0} days' },
          ]),
        ],
        labelSettings: labels({ DaysLeft: 'Renews in' }),
      },
    },
  ),
  argItem(
    'Alerts, last 30 days',
    [
      'alertsmanagementresources',
      "| where type =~ 'microsoft.alertsmanagement/alerts'",
      "| where resourceGroup =~ '{ResourceGroup}'",
      '| extend Fired = todatetime(properties.essentials.startDateTime),',
      '         Severity = tostring(properties.essentials.severity),',
      '         Condition = tostring(properties.essentials.monitorCondition),',
      '         State = tostring(properties.essentials.alertState),',
      '         Target = tostring(properties.essentials.targetResourceName)',
      '| project Fired, Alert = name, Severity, Condition, State, Target',
      '| order by Fired desc',
    ].join('\n'),
    {
      tab: 'overview',
      noDataMessage: 'No alerts fired in the last 30 days.',
      gridSettings: {
        formatters: [
          width('Fired', '18%'),
          width('Alert', '34%'),
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
  armItem('Latest deployment', '{Environment}/deployments', '2023-12-01', deploymentColumns, {
    tab: 'overview',
    customWidth: '50',
    noDataMessage: 'No deployments recorded for this web app.',
    gridSettings: deploymentGrid(1),
  }),
  kqlItem('Latest CustomerSync run', customerSyncQuery(1), {
    tab: 'overview',
    customWidth: '50',
    noDataMessage: customerSyncNoData,
    gridSettings: customerSyncGrid,
  }),
  logicRuns('Daily Digest — last 3 runs', 'DailyRecap', 3, { tab: 'overview' }),
  logicRuns('Instant Share — last 3 runs', 'InstantShare', 3, { tab: 'overview' }),

  // ===== Deployments =====
  armItem('App deployments, newest first', '{Environment}/deployments', '2023-12-01', deploymentColumns, {
    tab: 'deployments',
    noDataMessage: 'No deployments recorded for this web app.',
    gridSettings: deploymentGrid(),
  }),
  markdown(
    `Deployments come from the GitHub Actions deploy workflows ([Dev](${REPO}/actions/workflows/deploy-dev.yml) · [QA](${REPO}/actions/workflows/deploy-qa.yml) · [PROD](${REPO}/actions/workflows/deploy-prod.yml)). ` +
      'The deploy action records only the slot and outcome. The commit and build number running right now are shown in the app under the profile menu, which reads `/api/version`.',
    onTab('deployments'),
  ),

  // ===== Logic Apps =====
  logicRuns('Daily Digest — recent runs', 'DailyRecap', 25, { tab: 'logicapps' }),
  logicRuns('Instant Share — recent runs', 'InstantShare', 25, { tab: 'logicapps' }),
  markdown(
    `Full run history and resubmit: [Daily Digest](${PORTAL}{DailyRecap}/overview) · [Instant Share](${PORTAL}{InstantShare}/overview). ` +
      `Before resubmitting a Daily Digest run, read section E4 of the [outage recovery playbook](${REPO}/blob/main/docs/operations/OUTAGE-RECOVERY-PLAYBOOK.md): a resubmit sends the digest again.`,
    onTab('logicapps'),
  ),

  // ===== Background jobs =====
  kqlItem('CustomerSync runs — the mass-deactivation guard', customerSyncQuery(), {
    tab: 'jobs',
    noDataMessage: customerSyncNoData,
    gridSettings: customerSyncGrid,
  }),
  kqlItem(
    'CustomerSync schedule',
    [
      'traces',
      '| where timestamp {TimeRange}',
      '| where message startswith "CustomerSync next run scheduled for" or message startswith "CustomerSyncBackgroundService disabled"',
      '| top 1 by timestamp desc',
      '| project Logged = timestamp, Schedule = message',
    ].join('\n'),
    {
      tab: 'jobs',
      noDataMessage: 'No schedule line logged in this range. The service logs its next run after every cycle; widen the time range or check CustomerSync:RunAtTimeUtc in the app settings.',
      gridSettings: { formatters: [width('Logged', '20%')] },
    },
  ),
  kqlItem('Other background jobs — usage rollups, retention, CTRM keep-warm', otherJobsQuery, {
    tab: 'jobs',
    noDataMessage: 'No job completions in this range. Usage rollups run hourly; CTRM keep-warm runs continuously while CTRM is enabled.',
    gridSettings: { formatters: [width('Ran', '16%'), width('Job', '14%'), outcomeStatus, width('Message', '58%')] },
  }),

  // ===== Integrations =====
  kqlItem('Integrations — calls, failure rate and latency in the selected range', integrationsQuery, {
    tab: 'integrations',
    noDataMessage: 'No dependency telemetry in this range.',
    gridSettings: integrationsGrid,
  }),
  markdown(
    'Grouped by target so a slow or failing integration stands out. For individual calls, open Performance or Failures in App Insights (links below) and filter by the dependency name.',
    onTab('integrations'),
  ),

  // ===== Activity =====
  armItem(
    'Azure activity in this resource group — restarts, config changes, deployments, Logic App edits',
    '/subscriptions/{SubscriptionId}/providers/Microsoft.Insights/eventtypes/management/values',
    '2015-04-01',
    [
      ['$.eventTimestamp', 'When', 'datetime'],
      ['$.operationName.localizedValue', 'Operation'],
      ['$.status.localizedValue', 'Status'],
      ['$.caller', 'Who'],
      ['$.resourceId', 'Resource'],
    ],
    {
      tab: 'activity',
      urlParams: [
        { key: '$filter', value: "eventTimestamp ge '{TimeRange:startISO}' and resourceGroupName eq '{ResourceGroup}'" },
        { key: '$select', value: 'eventTimestamp,operationName,status,caller,resourceId' },
      ],
      noDataMessage: 'No management operations in this range. The activity log keeps 90 days.',
      gridSettings: {
        formatters: [
          width('When', '16%'),
          width('Operation', '30%'),
          thresholds('Status', [
            { operator: '==', thresholdValue: 'Succeeded', representation: 'success', text: '{0}{1}' },
            { operator: '==', thresholdValue: 'Failed', representation: 'failed', text: '{0}{1}' },
            { operator: '==', thresholdValue: 'Started', representation: 'pending', text: '{0}{1}' },
            { operator: 'Default', thresholdValue: null, representation: 'unknown', text: '{0}{1}' },
          ]),
          width('Who', '18%'),
          { columnMatch: 'Resource', formatter: 13, formatOptions: { linkTarget: 'Resource', showIcon: true } },
        ],
        sortBy: [{ itemKey: 'When', sortOrder: 2 }],
      },
    },
  ),
  markdown(
    'Each operation usually appears twice (Started, then Succeeded or Failed). "Who" is the signed-in user or the deploy identity.',
    onTab('activity'),
  ),

  // ===== Links (always visible) =====
  markdown('#### Go deeper'),
  linkColumn('App Insights — this environment', [
    ['Failures', `${PORTAL}{AppInsights}/failures`],
    ['Performance', `${PORTAL}{AppInsights}/performance`],
    ['Live Metrics', `${PORTAL}{AppInsights}/quickPulse`],
    ['Logs (KQL)', `${PORTAL}{AppInsights}/logs`],
  ]),
  linkColumn('Azure — this environment', [
    ['Web app overview', `${PORTAL}{Environment}/appServices`],
    ['Log stream', `${PORTAL}{Environment}/logStream`],
    ['Key Vault', `${PORTAL}{KeyVault}/overview`],
    ['Daily Digest Logic App', `${PORTAL}{DailyRecap}/overview`],
    ['Instant Share Logic App', `${PORTAL}{InstantShare}/overview`],
  ]),
  linkColumn('App and repo', [
    ['Open the app', '{AppUrl}'],
    ['Usage Dashboard (adoption)', '{AppUrl}/usage-dashboard'],
    ['Readiness probe', '{AppUrl}/health/ready'],
    ['GitHub Actions', `${REPO}/actions`],
    ['Project board', `${REPO}/projects`],
    ['Outage recovery playbook', `${REPO}/blob/main/docs/operations/OUTAGE-RECOVERY-PLAYBOOK.md`],
  ]),
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
