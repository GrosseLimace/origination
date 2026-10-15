// Local development (ng serve origination-mobile, port 4201) against the local .NET API.
// Sign-in is shared with the desktop, as Burdi's driver app shares Burdi's (user 2026-10-15): the
// 'Origination - Dev' SPA registration, whose redirect URIs already include http://localhost:4201, and the
// desktop Dev scope. The API must run with Mobile:SharedSignIn on (the base appsettings default).
export const environment = {
  production: false,
  envName: 'Local',
  apiBaseUrl: 'http://localhost:5000/api/mobile/v1',
  msal: {
    clientId: 'e0f25943-ae8b-4c2d-8060-c9ffbd448aff', // Origination - Dev (desktop SPA registration)
    authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
    redirectUri: 'http://localhost:4201',
    postLogoutRedirectUri: 'http://localhost:4201',
  },
  apiScopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev'],
};
