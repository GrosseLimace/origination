export const environment = {
  production: false,
  envName: 'QA',
  bidSheetEnabled: true,
  apiBaseUrl: '/api',
  msalConfig: {
    auth: {
      clientId: 'c2bb1208-063d-43aa-bad0-6b51d21437b4',
      authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
      redirectUri: 'https://origination-qa.scoular.com',
      postLogoutRedirectUri: 'https://origination-qa.scoular.com',
    }
  },
  apiConfig: {
    scopes: ['api://f3fcab2b-98c8-4622-86bd-c874d281b22a/Origination.Application.QA'],
    uri: '/api/*'
  }
};
