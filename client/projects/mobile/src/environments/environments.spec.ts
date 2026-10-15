import { describe, expect, it } from 'vitest';

import { environment as dev } from './environment.dev';
import { environment as prod } from './environment.prod';
import { environment as qa } from './environment.qa';
import { environment as local } from './environment';

/**
 * Burdi shipped a production bundle with localhost URLs once because a per-env file was wrong
 * (app-context/deployment-and-config.md:128). This pins the shape of every deployed environment.
 */
describe('mobile environments', () => {
  const deployed = { dev, qa, prod };

  it.each(Object.entries(deployed))('%s has no localhost anywhere', (_name, env) => {
    const text = JSON.stringify(env);
    expect(text).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(env.production).toBe(true);
  });

  it('local points at the local API on port 5000 (not 5001) and the mobile prefix', () => {
    expect(local.apiBaseUrl).toBe('http://localhost:5000/api/mobile/v1');
    expect(local.production).toBe(false);
  });

  // Grain Vision's external app (user 2026-10-15): its own Static Web App (Dev on ext-origination-dev, QA/Prod on the
  // desktop's address via split-horizon DNS), the API through APIM at /external/origination/v1 in every environment,
  // and the desktop sign-in of THAT environment — never another's (a QA bundle with the Dev id would fail sign-in).
  it.each([
    ['dev', dev, 'https://ext-origination-dev.scoular.com', 'https://apidev.scoular.com', 'Origination.Application.Dev', '00078a10-3f3f-4d17-9350-fe90401125ae', 'e0f25943-ae8b-4c2d-8060-c9ffbd448aff'],
    ['qa', qa, 'https://origination-qa.scoular.com', 'https://apiqa.scoular.com', 'Origination.Application.QA', 'f3fcab2b-98c8-4622-86bd-c874d281b22a', 'c2bb1208-063d-43aa-bad0-6b51d21437b4'],
    ['prod', prod, 'https://origination.scoular.com', 'https://api.scoular.com', 'Origination.Application.Prod', 'e1458bcd-7212-4ea0-a836-7e08d03b5bbf', '958fd665-daa3-42c5-9903-3c9c00638bf1'],
  ])('%s is its own site, calls the API through APIM, and signs in like its desktop', (_n, env, site, apim, scope, apiAppId, spaClientId) => {
    expect(env.apiBaseUrl).toBe(`${apim}/external/origination/v1`);
    expect(env.msal.redirectUri).toBe(site);
    expect(env.msal.postLogoutRedirectUri).toBe(site);
    expect(env.msal.clientId).toBe(spaClientId);
    expect(env.apiScopes).toEqual([`api://${apiAppId}/${scope}`]);
  });

  it('no deployed environment calls the private App Service directly', () => {
    for (const env of [dev, qa, prod]) {
      expect(env.apiBaseUrl).not.toMatch(/origination(-dev|-qa)?\.scoular\.com|azurewebsites\.net/);
    }
  });

  it('local signs in with the Dev desktop registration on the port it is served from', () => {
    expect(local.msal.clientId).toBe('e0f25943-ae8b-4c2d-8060-c9ffbd448aff');
    expect(local.msal.redirectUri).toBe('http://localhost:4201');
    expect(local.apiScopes).toEqual(['api://00078a10-3f3f-4d17-9350-fe90401125ae/Origination.Application.Dev']);
  });

  it('no environment is left with a placeholder client id', () => {
    for (const env of [local, dev, qa, prod]) {
      expect(env.msal.clientId).not.toBe('00000000-0000-0000-0000-000000000000');
    }
  });

  it('every environment uses the Scoular tenant authority', () => {
    for (const env of [local, dev, qa, prod]) {
      expect(env.msal.authority).toBe('https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1');
    }
  });
});
