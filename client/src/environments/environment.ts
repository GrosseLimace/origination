export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:5000/api',
  msalConfig: {
    clientId: '',  // Dev SPA Client ID — set in local environment or user secrets
    tenantId: '1521f999-f722-4a4f-9747-166f93e9b0d1',
    redirectUri: 'http://localhost:4200',
    apiScope: ''   // Dev API scope URI (e.g. api://<client-id>/access_as_user)
  }
};
