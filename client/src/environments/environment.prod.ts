export const environment = {
  production: true,
  // Title case to match Local / Dev / QA — the original value here was lowercase
  // 'production', which rendered an odd lowercase pill next to the title-cased ones.
  envName: 'Production',
  bidSheetEnabled: true,
  // "Add from BarChart" picker + fed-bid display. Off until the vendor feed is live in this environment.
  barchartBidsEnabled: false,
  usageDashboardEnabled: true,
  // Daily Digest (recap groups): ON in PROD. Surfaces the /daily-digest route + the
  // "Daily Recap" nav link. NOTE: enabling the UI is only half of launch — the prod
  // Notes Daily Recap Logic App must also be deployed (it's what actually sends the
  // recaps), and the recap migrations (CreateDailyRecapGroups, AddGetRecapNotesProc)
  // must be applied to the prod DB. Merge this branch as part of that launch.
  dailyDigestEnabled: true,
  // Originator Calculators: ON in PROD. Gates the floating calculator launcher on the
  // customer home page (Profitability / Check / Cancel-vs-Roll). Client-side only — no backend.
  calculatorEnabled: true,
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
