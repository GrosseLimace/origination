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
  // Trade Unit Preferences app (users manage their own trade-unit / group assignments there;
  // this app only reads the result). Opened from the profile menu in a popup window.
  tradeUnitPreferencesUrl: 'https://tradeunitprefs-dev.scoular.com/my-preferences',
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
  }
};
