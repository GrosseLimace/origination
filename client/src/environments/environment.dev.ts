export const environment = {
  production: false,
  envName: 'Dev',
  bidSheetEnabled: true,
  // Bid Sheet map engine A/B toggle (docs/poc/bid-sheet-map/) — MapLibre is the default
  // in every environment, including prod, from day one; Leaflet stays available via the
  // dev-visible runtime toggle.
  bidSheetMapLibreDefault: true,
  usageDashboardEnabled: true,
  dailyDigestEnabled: true,
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
  }
};
