export const environment = {
  production: false,
  envName: 'Local',
  bidSheetEnabled: true,
  // "Add from BarChart" picker + fed-bid display. Off until the vendor feed is live in this environment.
  barchartBidsEnabled: true,
  usageDashboardEnabled: true,
  // 'NOP ID on file, no certificate' Actionable Insights category (trade unit 2080 only).
  // Compares two independent pipelines: the NOP id from Profisee via the nightly customer sync,
  // and the certification from the integration team's feed. Until that feed is live EVERY organic
  // producer qualifies - ~580 - so this stays OFF in Production until the first run has landed.
  organicMissingCertificatesEnabled: true,   // local: on, so the category can be developed against seeded data
  dailyDigestEnabled: true,
  // @-mention a Teams channel in a note. Needs delegated Channel.ReadBasic.All with admin consent
  // on THIS environment's SPA app registration; without it the channel lookup returns nothing, so
  // the flag stays off rather than showing an empty, apparently-broken picker section.
  teamsChannelMentionsEnabled: true,
  calculatorEnabled: true,
  // Contract Workspace (CWS) at /cws, signed in with our own session. On sample data by default
  // (`cws.sampleData` below), so the Contracts API does not have to be running.
  contractWorkspaceEnabled: true,
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
  // Incoming-call popup: a producer calling your Teams number pops their name + code here, with
  // Answer / Decline / Hold. Also needs Acs:Endpoint on the API (token endpoint answers 204 until
  // IT provisions the ACS resource + Teams.ManageCalls consent), so ON here is harmless: with no
  // token the calling SDK is never even downloaded. Outside production the profile menu offers
  // "Simulate incoming call" to exercise the popup without a real call.
  incomingCallEnabled: true,
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
  apiBaseUrl: 'http://localhost:5000/api',
  msalConfig: {
    auth: {
      clientId: 'e0f25943-ae8b-4c2d-8060-c9ffbd448aff',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'http://localhost:4200'
    }
  },
  apiConfig: {
    uri: 'http://localhost:5000/api/*',
    scopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev']
  },
  // Contract Workspace (/cws): the Contracts API it calls, and the scope our own sign-in requests for
  // it. Public identifiers, not secrets. Locally the API is run from the
  // contract-management-system repo on its https launch profile: its http port (5215) answers with a
  // redirect, which a browser will not follow on a CORS preflight. Its Development environment
  // already allows http://localhost:4200. The scope is the Dev one: a local run validates against the
  // Dev registration.
  //
  // sampleData: true serves the CWS team's stubs and sends nothing to any API, so apiUrl is unused.
  // Sign-in stays real either way, so it still needs a Contracts role (User or Admin) on your account.
  // Set false to run against the local Contracts API above.
  cws: {
    apiUrl: 'https://localhost:7041/api/v1',
    scopes: ['api://5050fd5c-b7a8-4908-81fc-8d32e596eb1d/ContractManagementSystem.Application.Dev'],
    environmentName: 'local',
    sampleData: true
  }
};
