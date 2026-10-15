// Dev, following Grain Vision's external app (user 2026-10-15): the mobile app is its own Azure Static Web App at
// https://ext-origination-dev.scoular.com and calls the API through APIM (apidev.scoular.com), as Grain Vision's
// Dev external app does since its "QA Mobile Requirements" change, so Dev works off the Scoular network too.
// The App Service itself stays private.
// Sign-in is shared with the desktop, as in Grain Vision (and Burdi): the 'Origination - Dev' SPA registration, with
// the external Dev address added as a redirect URI, and the desktop scope.
export const environment = {
  production: true,
  envName: 'Dev',
  apiBaseUrl: 'https://apidev.scoular.com/external/origination/v1',
  msal: {
    clientId: 'e0f25943-ae8b-4c2d-8060-c9ffbd448aff', // Origination - Dev (desktop SPA registration)
    authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
    redirectUri: 'https://ext-origination-dev.scoular.com',
    postLogoutRedirectUri: 'https://ext-origination-dev.scoular.com',
  },
  apiScopes: ['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev'],
};
