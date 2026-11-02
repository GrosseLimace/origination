export const environment = {
  production: true,
  // Title case to match Local / Dev / QA — the original value here was lowercase
  // 'production', which rendered an odd lowercase pill next to the title-cased ones.
  envName: 'Production',
  bidSheetEnabled: true,
  // "Add from BarChart" picker + fed-bid display. ON since the 2026-10-20 release: the PROD catalog
  // finished its first full 7-day load on 2026-10-20 (84k listings, 4,024 locations, priced daily).
  barchartBidsEnabled: true,
  usageDashboardEnabled: true,
  // 'NOP ID on file, no certificate' Actionable Insights category (trade unit 2080 only).
  // Compares two independent pipelines: the NOP id from Profisee via the nightly customer sync,
  // and the certification from the integration team's feed. Until that feed is live EVERY organic
  // producer qualifies - ~580 - so this stays OFF in Production until the first run has landed.
  organicMissingCertificatesEnabled: false,
  // Daily Digest (recap groups): ON in PROD. Surfaces the /daily-digest route + the
  // "Daily Recap" nav link. NOTE: enabling the UI is only half of launch — the prod
  // Notes Daily Recap Logic App must also be deployed (it's what actually sends the
  // recaps), and the recap migrations (CreateDailyRecapGroups, AddGetRecapNotesProc)
  // must be applied to the prod DB. Merge this branch as part of that launch.
  dailyDigestEnabled: true,
  // @-mention a Teams channel in a note. Needs delegated Channel.ReadBasic.All with admin consent
  // on THIS environment's SPA app registration, plus a federated identity credential on the
  // 'Origination API - Production' registration for the on-behalf-of exchange (see
  // appsettings.Production.json).
  //
  // ⚠ Enabled 2026-09-21 on the basis that both land BEFORE the deploy. If the grant slips this
  // ships an empty channel picker — and because these flags are compiled in at build time
  // (angular.json fileReplacements), switching it back off needs another full client deploy, not
  // a config change. Verify the consent is live before releasing.
  teamsChannelMentionsEnabled: true,
  // Originator Calculators: ON in PROD. Gates the floating calculator launcher on the
  // customer home page (Profitability / Check / Cancel-vs-Roll). Client-side only — no backend.
  calculatorEnabled: true,
  // Contract Workspace (CWS) at /cws. Off: the `cws` block below lists what Prod still needs.
  contractWorkspaceEnabled: false,
  // CTRM read-ahead: the 350ms hover prefetch on the producer list and the 4s post-click
  // convergence re-read. Both exist to hide CTRM GraphQL latency, and both cost an extra read per
  // hovered row and per click.
  //
  // MUST TRACK the effective Ctrm:Source. ON because PROD flips to CTRM on 2026-09-29, the same day
  // this ships. Without it a click can render a trade-unit-cached answer minutes old with no
  // convergence pass behind it to replace it — the stale-read problem the 4s re-read exists to
  // solve. Turn it OFF again if PROD is ever rolled back to ODS for more than a short window:
  // against ODS the read-ahead buys nothing (it answers fast and keeps no server-side trade-unit
  // cache to converge on) and just multiplies reads on the busiest page.
  //
  // ⚠ Compiled in at build time (angular.json fileReplacements), so unlike Ctrm__Source this is NOT
  // an App Service setting — changing it needs a client redeploy, not a restart. That asymmetry is
  // the thing to remember: rolling CTRM back is instant, but this flag will still be on until a
  // redeploy. Harmless for a brief rollback (extra ODS reads, correct data), worth a redeploy if
  // the rollback is going to stand.
  //
  // ON since the 2026-10-06 CTRM go-live: every environment reads contracts and tickets from CTRM.
  ctrmReadAheadEnabled: true,
  // Producer follow-up reminders. Writing the Outlook event needs delegated Calendars.ReadWrite
  // admin consent on this env SPA app registration.
  //
  // ⚠ Enabled 2026-09-21 on the same basis as the Teams flag above, and it shares the same OBO
  // plumbing — so the two succeed or fail together. If the consent slips, a reminder saves in the
  // app but silently fails to create the Outlook event, which is worse than the feature being
  // absent: the user believes they have been reminded.
  remindersEnabled: true,
  // Prints each incoming call's callerInfo / transferorInfo to the console. OFF: the caller's
  // number is PII, and real producers' calls ring this environment's tab too.
  logCallerInfo: false,
  // Incoming-call popup (ACS Teams-user calling). OFF: Dev-only spike until Microsoft confirms
  // the scenario stays supported past the 2028 ACS retirement and a pilot originator signs off.
  incomingCallEnabled: false,
  // "Simulate incoming call" in the profile menu. OFF: local and Dev only.
  incomingCallSimulatorEnabled: false,
  // Azure Communication Services scopes the browser asks Entra for when the incoming-call popup
  // starts; the API exchanges that token for a calling token (POST /calling/token). Admin consent
  // for them lives on THIS environment's SPA registration — granted for Dev on 2026-10-27, not yet
  // for QA or PROD. Not added to the MSAL protected-resource map or the login request on purpose:
  // they are requested explicitly, only when the call agent starts.
  acs: {
    teamsScopes: [
      'https://auth.msft.communication.azure.com/Teams.ManageCalls',
      'https://auth.msft.communication.azure.com/Teams.ManageChats',
    ],
  },
  // 45Z field data + carbon intensity: prototype only, not released here.
  carbonIntensityEnabled: false,
  // Plan by field: prototype only, not released here.
  fieldPlanningEnabled: false,
  // Where the field plan is kept: 'memory' (in the browser; a reload starts over) or 'api' (api/field-plan,
  // the database). 'memory' until this environment's deploy has created the field-plan tables, then 'api'.
  // Split IDs are typed by hand until CTRM's splits query is live (SPLITS-GRAPHQL). See docs/application-context/Field Plan - Database Plan.md.
  fieldPlanBackend: 'memory' as 'memory' | 'api',
  // Trade Unit Preferences app (users manage their own trade-unit / group assignments there;
  // this app only reads the result). Opened from the profile menu in a popup window.
  tradeUnitPreferencesUrl: 'https://tradeunitprefs.scoular.com/my-preferences',
  // ServiceNow form behind the Help panel's "Still need help?" card (one ServiceNow instance, so the
  // same form in every environment). The card walks the user through it: open the form, pick
  // helpDeskTopic, then copy the short description and additional information in. A plain link —
  // nothing is added to the URL; the details travel by clipboard. Empty URL hides the walk-through.
  // SIMS replaces ServiceNow at the end of November 2026: change these two values at cutover.
  helpDeskUrl: 'https://scoular.service-now.com/sp?id=sc_cat_item&sys_id=7c12ac1ddbc43340289064904b961939&sysparm_category=99935075db949f00df8168d35b96192b',
  // The topic users pick on that form. "Something Else" until the Help Desk adds an Origination topic.
  helpDeskTopic: 'Something Else',
  apiBaseUrl: '/api',
  msalConfig: {
    auth: {
      clientId: '958fd665-daa3-42c5-9903-3c9c00638bf1',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'https://origination.scoular.com',
      postLogoutRedirectUri: 'https://origination.scoular.com'
    }
  },
  apiConfig: {
    uri: '/api/*',
    scopes: ['api://e1458bcd-7212-4ea0-a836-7e08d03b5bbf/Origination.Application.Prod']
  },
  // Contract Workspace (/cws): the Contracts API it calls, and the scope our own sign-in requests for
  // it. Public identifiers, not secrets, from the CWS team's Prod app registrations; the
  // Prod-to-Prod pairing is not yet confirmed with the CWS team. Still needed before the route is on
  // here: the delegated permission and consent on this SPA registration, cms allowing this origin
  // (CORS), and its host in SecurityHeaders:SpaConnectSrcHosts. 'prod' shows no environment chip.
  cws: {
    apiUrl: 'https://cms.scoular.com/api/v1',
    scopes: ['api://8e2aac30-2994-47bd-be02-f626327c9e9c/ContractManagementSystem.Application.Prod'],
    environmentName: 'prod',
    // Local only: sample data instead of the API. Never true in a deployed environment.
    sampleData: false
  }
};
