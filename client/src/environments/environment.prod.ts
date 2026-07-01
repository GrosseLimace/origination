export const environment = {
  production: true,
  envName: 'production',
  bidSheetEnabled: true,
  usageDashboardEnabled: true,
  // Daily Digest (recap groups): OFF in PROD until the feature launches. Gates the
  // /daily-digest route + the "Daily Recap" nav link. Flip to true (and deploy the
  // Logic App + apply the recap migrations) when launching.
  dailyDigestEnabled: false,
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
