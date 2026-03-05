export const environment = {
  production: true,
  apiBaseUrl: '/api',
  msalConfig: {
    clientId: '',  // Prod SPA Client ID — injected via Azure App Service config
    tenantId: '1521f999-f722-4a4f-9747-166f93e9b0d1',
    redirectUri: 'https://origination.scoular.com',
    apiScope: ''   // Prod API scope URI — injected via Azure App Service config
  }
};
