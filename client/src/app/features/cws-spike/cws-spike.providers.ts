/*
 * SPIKE: the Contract Workspace (CWS) 0.2.0 mounted whole under /cws, on sample data.
 *
 * provideCwsWorkspace(CWS_SPIKE_CONFIG) is the real contract. CWS_SPIKE_OVERRIDES replaces every
 * HTTP source it wires with the CWS team's stubs (cws-spike.stubs.ts, copied verbatim from their
 * sample host) and swaps the route's HttpBackend for one that refuses every request, so nothing
 * leaves the browser.
 *
 * 🔴 NEVER SHIP THE OVERRIDES. The fake MSAL instance signs anyone in as a CWS administrator with an
 * unsigned token. The route is gated by environment.cwsSpikeEnabled, which is true only locally.
 */
import type { Provider } from '@angular/core';
import { HttpBackend } from '@angular/common/http';
import type { AccountInfo } from '@azure/msal-browser';
import { CWS_MSAL_INSTANCE, FAKE_ACCOUNT, fakePublicClientApplication } from '@cws/core-auth';
import {
  APPROVAL_ACTION_SOURCE,
  APPROVAL_CONTRACT_SOURCE,
  AVAILABILITY_SOURCE,
  CONTRACT_DETAIL_SOURCE,
  CONTRACT_EXPORT_SOURCE,
  CONTRACT_LIST_SOURCE,
  CONTRACT_LOG_SOURCE,
  CONTRACT_NUMBER_SOURCE,
  CONTRACT_STATE_SOURCE,
  CONTRACT_TEMPLATE_SOURCE,
  CONTRACT_WRITE_SOURCE,
  CUSTOMER_SOURCE,
  FORM_CONFIG_ADMIN_SOURCE,
  FORM_CONFIG_SOURCE,
  LOCATION_SOURCE,
  ME_SOURCE,
  MARKET_REFERENCE_SOURCE,
  PRICING_SOURCE,
  SampleContractExportSource,
  SampleContractListSource,
  SampleCustomerSource,
  SampleMeSource,
  TRADE_UNIT_VALUES_SOURCE,
} from '@cws/domain-contracts';
import { MockFormConfigSource } from '@cws/features-contract-entry';
import type { CwsWorkspaceConfig } from '@cws/workspace';

import {
  HostApprovalActionSource,
  HostApprovalContractSource,
  HostAvailabilitySource,
  HostContractDetailSource,
  HostContractLogSource,
  HostContractNumberSource,
  HostContractStateSource,
  HostContractTemplateSource,
  HostContractWriteSource,
  HostFormConfigAdminSource,
  HostLocationSource,
  HostMarketReferenceSource,
  HostOfflineBackend,
  HostPricingSource,
  HostTradeUnitValuesSource,
} from './cws-spike.stubs';

/*
 * Mode A (CWS signs in with its own MSAL instance against the CWS Dev SPA registration). Public
 * identifiers from the CWS onboarding guide, not secrets. Inert while the overrides are in place:
 * the fake instance answers instead of Entra. loginHint would come from our MsalService's active
 * account in a real mount.
 */
export const CWS_SPIKE_CONFIG: CwsWorkspaceConfig = {
  apiUrl: 'https://cms-dev.scoular.com/api/v1',
  auth: {
    clientId: 'a1b87993-f4c5-4c9f-ab9f-7804a32649f6',
    authority: 'https://login.microsoftonline.com/1521f999-f722-4a4f-9747-166f93e9b0d1',
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    apiScopes: ['api://5050fd5c-b7a8-4908-81fc-8d32e596eb1d/ContractManagementSystem.Application.Dev'],
    interaction: 'popup',
    silentSignIn: true,
    loginHint: () => null,
    silentRedirectUri: `${window.location.origin}/cws-auth.html`,
  },
  environmentName: 'dev',
  theme: 'host',
  embedded: true,
};

/** An unsigned token whose payload carries roles: ["Admin"], so CWS decodes Admin from it. */
const SPIKE_TOKEN =
  'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' +
  btoa(JSON.stringify({ roles: ['Admin'], aud: 'cws-test' }))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_') +
  '.unsigned';

const SPIKE_ACCOUNT: AccountInfo = {
  ...FAKE_ACCOUNT,
  username: 'someone@scoular.com',
  name: 'Someone At Scoular',
};

/** Must come AFTER provideCwsWorkspace on the route: the later provider wins. */
export const CWS_SPIKE_OVERRIDES: Provider[] = [
  {
    provide: CWS_MSAL_INSTANCE,
    useFactory: () =>
      fakePublicClientApplication({ account: SPIKE_ACCOUNT, accessToken: SPIKE_TOKEN, ssoSilent: 'succeeds' }),
  },
  { provide: CONTRACT_LIST_SOURCE, useClass: SampleContractListSource },
  { provide: AVAILABILITY_SOURCE, useClass: HostAvailabilitySource },
  { provide: ME_SOURCE, useClass: SampleMeSource },
  { provide: CUSTOMER_SOURCE, useClass: SampleCustomerSource },
  { provide: CONTRACT_STATE_SOURCE, useClass: HostContractStateSource },
  { provide: CONTRACT_LOG_SOURCE, useClass: HostContractLogSource },
  { provide: CONTRACT_TEMPLATE_SOURCE, useClass: HostContractTemplateSource },
  { provide: CONTRACT_EXPORT_SOURCE, useClass: SampleContractExportSource },
  { provide: PRICING_SOURCE, useClass: HostPricingSource },
  { provide: MARKET_REFERENCE_SOURCE, useClass: HostMarketReferenceSource },
  { provide: TRADE_UNIT_VALUES_SOURCE, useClass: HostTradeUnitValuesSource },
  { provide: LOCATION_SOURCE, useClass: HostLocationSource },
  { provide: CONTRACT_DETAIL_SOURCE, useClass: HostContractDetailSource },
  { provide: APPROVAL_CONTRACT_SOURCE, useClass: HostApprovalContractSource },
  { provide: FORM_CONFIG_SOURCE, useClass: MockFormConfigSource },
  { provide: CONTRACT_WRITE_SOURCE, useClass: HostContractWriteSource },
  { provide: CONTRACT_NUMBER_SOURCE, useClass: HostContractNumberSource },
  { provide: FORM_CONFIG_ADMIN_SOURCE, useClass: HostFormConfigAdminSource },
  { provide: APPROVAL_ACTION_SOURCE, useClass: HostApprovalActionSource },
  HostOfflineBackend,
  { provide: HttpBackend, useExisting: HostOfflineBackend },
];
