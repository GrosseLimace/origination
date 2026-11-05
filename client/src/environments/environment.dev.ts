export const environment = {
  production: false,
  envName: 'Dev',
  bidSheetEnabled: true,
  // "Add from BarChart" picker + fed-bid display. Off until the vendor feed is live in this environment.
  barchartBidsEnabled: true,
  usageDashboardEnabled: true,
  dailyDigestEnabled: true,
  // @-mention a Teams channel in a note. Needs delegated Channel.ReadBasic.All with admin consent
  // on THIS environment's SPA app registration; without it the channel lookup returns nothing, so
  // the flag stays off rather than showing an empty, apparently-broken picker section.
  teamsChannelMentionsEnabled: true,
  calculatorEnabled: true,
  // Contract Workspace (CWS) at /cws. Off until cms-dev allows this origin (CORS, CWS #576) and its
  // host is in SecurityHeaders:SpaConnectSrcHosts; until then every CWS call fails in the browser.
  contractWorkspaceEnabled: false,
  // CTRM read-ahead: the 350ms hover prefetch on the producer list and the 4s post-click
  // convergence re-read. Both exist to hide CTRM GraphQL latency behind a warm trade-unit cache,
  // and both cost an extra read per hovered row and per click. Worth it when the backend is
  // reading CTRM; pure extra load when it is reading ODS, which answers fast and has no server-side
  // trade-unit cache to converge on.
  // ON since the 2026-10-06 CTRM go-live: every environment reads contracts and tickets from CTRM.
  ctrmReadAheadEnabled: true,
  // Producer follow-up reminders. Writing the Outlook event needs delegated Calendars.ReadWrite
  // admin consent on this env SPA app registration; keep false until that consent is granted.
  remindersEnabled: true,
  // 45Z field data + carbon intensity. Scores come from the USDA FD-CIC API (api/fd-cic);
  // on in every environment (45Z go-live).
  carbonIntensityEnabled: true,
  // Plan by field: a producer's fields under each crop row, their acres breaking down the row's total.
  // On in every environment (45Z go-live).
  fieldPlanningEnabled: true,
  // Where the field plan is kept: 'memory' (in the browser; a reload starts over) or 'api' (api/field-plan,
  // the database). 'memory' until this environment's deploy has created the field-plan tables, then 'api'.
  // Split IDs are typed by hand until CTRM's splits query is live (SPLITS-GRAPHQL). See docs/application-context/Field Plan - Database Plan.md.
  fieldPlanBackend: 'api' as 'memory' | 'api',
  // Trade Unit Preferences app (users manage their own trade-unit / group assignments there;
  // this app only reads the result). Opened from the profile menu in a popup window.
  tradeUnitPreferencesUrl: 'https://tradeunitprefs-dev.scoular.com/my-preferences',
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
      clientId: 'e0f25943-ae8b-4c2d-8060-c9ffbd448aff',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'https://origination-dev.scoular.com',
      postLogoutRedirectUri: 'https://origination-dev.scoular.com',
    }
  },
  apiConfig: {
    scopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev'],
    uri: '/api/*'
  },
  // Contract Workspace (/cws): the Contracts API it calls, and the scope our own sign-in requests for
  // it. Public identifiers, not secrets. Consent is in place: this SPA registration is the
  // local one, where it was tested 2026-10-21. Still needed before the route is on here: cms-dev must
  // allow this origin (CORS, CWS #576), and its host must be in SecurityHeaders:SpaConnectSrcHosts.
  cws: {
    apiUrl: 'https://cms-dev.scoular.com/api/v1',
    scopes: ['api://5050fd5c-b7a8-4908-81fc-8d32e596eb1d/ContractManagementSystem.Application.Dev'],
    environmentName: 'dev',
    // Local only: sample data instead of the API. Never true in a deployed environment.
    sampleData: false
  }
};
