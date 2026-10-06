export const environment = {
  production: true,
  // Title case to match Local / Dev / QA — the original value here was lowercase
  // 'production', which rendered an odd lowercase pill next to the title-cased ones.
  envName: 'Production',
  bidSheetEnabled: true,
  usageDashboardEnabled: true,
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
  // Trade Unit Preferences app (users manage their own trade-unit / group assignments there;
  // this app only reads the result). Opened from the profile menu in a popup window.
  tradeUnitPreferencesUrl: 'https://tradeunitprefs.scoular.com/my-preferences',
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
  }
};
