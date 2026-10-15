// QA, following Grain Vision's external app (user 2026-10-15): the mobile app is its own Azure Static Web App on
// the SAME address as the desktop (split-horizon DNS: from the internet origination-qa.scoular.com reaches the Static
// Web App, on the Scoular network it reaches the desktop App Service). It calls the API through APIM
// (apiqa.scoular.com, App Gateway + WAF in front); the App Service itself stays private.
// Sign-in is shared with the desktop, as in Grain Vision: the 'Origination - QA' SPA registration, whose existing
// redirect URI already matches this address, and the desktop scope.
export const environment = {
  production: true,
  envName: 'QA',
  apiBaseUrl: 'https://apiqa.scoular.com/external/origination/v1',
  msal: {
    clientId: 'c2bb1208-063d-43aa-bad0-6b51d21437b4', // Origination - QA (desktop SPA registration)
    authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
    redirectUri: 'https://origination-qa.scoular.com',
    postLogoutRedirectUri: 'https://origination-qa.scoular.com',
  },
  apiScopes: ['api://f3fcab2b-98c8-4622-86bd-c874d281b22a/Origination.Application.QA'],
};
