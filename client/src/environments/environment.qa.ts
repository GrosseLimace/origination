export const environment = {
  production: false,
  envName: 'QA',
  bidSheetEnabled: true,
  // "Add from BarChart" picker + fed-bid display. On for QA testing. The catalog must be loaded before
  // testers look: an empty catalog makes the picker return nothing, which reads as a broken feature
  // rather than as missing data.
  barchartBidsEnabled: true,
  usageDashboardEnabled: true,
  // 'NOP ID on file, no certificate' Actionable Insights category (trade unit 2080 only).
  // Compares two independent pipelines: the NOP id from Profisee via the nightly customer sync,
  // and the certification from the integration team's feed. Until that feed is live EVERY organic
  // producer qualifies - ~580 - so this stays OFF in Production until the first run has landed.
  organicMissingCertificatesEnabled: true,
  dailyDigestEnabled: true,
  // @-mention a Teams channel in a note. The channel lookup runs in the API on-behalf-of the caller,
  // so it needs delegated Team.ReadBasic.All + Channel.ReadBasic.All with admin consent on the API
  // app registration (NOT the SPA — that moved server-side on 2026-09-15) and a federated credential
  // binding that registration to the App Service managed identity. Both granted in QA on 2026-09-18,
  // so this is on. Without them the lookup returns nothing and the picker section looks broken.
  teamsChannelMentionsEnabled: true,
  calculatorEnabled: true,
  // CTRM read-ahead: the 350ms hover prefetch on the producer list and the 4s post-click
  // convergence re-read. Both exist to hide CTRM GraphQL latency behind a warm trade-unit cache,
  // and both cost an extra read per hovered row and per click. Worth it when the backend is
  // reading CTRM; pure extra load when it is reading ODS, which answers fast and has no server-side
  // trade-unit cache to converge on.
  // ON since the 2026-10-06 CTRM go-live: every environment reads contracts and tickets from CTRM.
  ctrmReadAheadEnabled: true,
  // Producer follow-up reminders. Writing the Outlook event needs delegated Calendars.ReadWrite with
  // admin consent on the API app registration, same credential as above. Granted in QA 2026-09-18.
  remindersEnabled: true,
  // Trade Unit Preferences app (users manage their own trade-unit / group assignments there;
  // this app only reads the result). Opened from the profile menu in a popup window.
  tradeUnitPreferencesUrl: 'https://tradeunitprefs-qa.scoular.com/my-preferences',
  apiBaseUrl: '/api',
  msalConfig: {
    auth: {
      clientId: 'c2bb1208-063d-43aa-bad0-6b51d21437b4',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'https://origination-qa.scoular.com',
      postLogoutRedirectUri: 'https://origination-qa.scoular.com',
    }
  },
  apiConfig: {
    scopes: ['api://f3fcab2b-98c8-4622-86bd-c874d281b22a/Origination.Application.QA'],
    uri: '/api/*'
  }
};
