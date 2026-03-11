export const environment = {
  production: false,
  envName: 'Local',
  apiBaseUrl: 'http://localhost:5000/api',
  msalConfig: {
    auth: {
      clientId: 'e0f25943-ae8b-4c2d-8060-c9ffbd448aff',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: window.location.origin
    }
  },
  apiConfig: {
    uri: 'http://localhost:5000/api/*',
    scopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev']
  }
};
