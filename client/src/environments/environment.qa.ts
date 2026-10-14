export const environment = {
  production: false,
  envName: 'QA',
  bidSheetEnabled: true,
  usageDashboardEnabled: true,
  dailyDigestEnabled: true,
  // @-mention a Teams channel in a note. Needs delegated Channel.ReadBasic.All with admin consent
  // on THIS environment's SPA app registration, plus a federated identity credential on the
  // 'Origination API - QA' registration for the on-behalf-of exchange (see appsettings.QA.json).
  // Both granted 2026-09-21 — enabled. Without them the channel lookup returns nothing, so this
  // stays false rather than showing an empty, apparently-broken picker section.
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
  // admin consent on this env SPA app registration. Granted 2026-09-21 — enabled.
  remindersEnabled: true,
  // Trade Unit Preferences app (users manage their own trade-unit / group assignments there;
  // this app only reads the result). Opened from the profile menu in a popup window.
  tradeUnitPreferencesUrl: 'https://tradeunitprefs-qa.scoular.com/my-preferences',
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
