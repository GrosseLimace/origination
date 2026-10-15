// Production, following Grain Vision's external app (user 2026-10-15): the mobile app is its own Azure Static Web
// App on the SAME address as the desktop (split-horizon DNS: from the internet origination.scoular.com reaches the
// Static Web App, on the Scoular network it reaches the desktop App Service). It calls the API through APIM
// (api.scoular.com, App Gateway + WAF in front); the App Service itself stays private.
// Sign-in is shared with the desktop, as in Grain Vision: the 'Origination - Production' SPA registration, whose
// existing redirect URI already matches this address, and the desktop scope.
export const environment = {
  production: true,
  envName: 'Production',
  apiBaseUrl: 'https://api.scoular.com/external/origination/v1',
  msal: {
    clientId: '958fd665-daa3-42c5-9903-3c9c00638bf1', // Origination - Production (desktop SPA registration)
    authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
    redirectUri: 'https://origination.scoular.com',
    postLogoutRedirectUri: 'https://origination.scoular.com',
  },
  apiScopes: ['api://e1458bcd-7212-4ea0-a836-7e08d03b5bbf/Origination.Application.Prod'],
};
