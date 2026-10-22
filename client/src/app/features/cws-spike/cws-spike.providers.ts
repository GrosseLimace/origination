/*
 * SPIKE: the Contract Workspace (CWS) 0.2.0 mounted whole under /cws.
 *
 * provideCwsWorkspace(CWS_SPIKE_CONFIG) is the real contract. Passing a tokenProvider makes CWS use
 * Origination's own MSAL session for the Contracts API token (cws-host-token-provider.ts) instead of
 * signing in a second time with an MSAL instance of its own.
 *
 * The route is gated by environment.contractWorkspaceEnabled.
 */
import type { Provider } from '@angular/core';
import { HttpBackend } from '@angular/common/http';
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

import { environment } from '../../../environments/environment';
import { originationCwsTokenProvider } from './cws-host-token-provider';
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

/** The API, its scope and the environment chip are per environment (environment.cws). */
export const CWS_SPIKE_CONFIG: CwsWorkspaceConfig = {
  apiUrl: environment.cws.apiUrl,
  auth: {
    tokenProvider: originationCwsTokenProvider,
    apiScopes: environment.cws.scopes,
  },
  environmentName: environment.cws.environmentName,
  theme: 'host',
  embedded: true,
};

/**
 * Sample data instead of the Contracts API, for environment.cws.sampleData. Every data source CWS
 * wires is replaced with the CWS team's stubs (cws-spike.stubs.ts, copied verbatim from their sample
 * host), and the route's HttpBackend with one that refuses every request, so nothing reaches an API.
 * Sign-in is still real: the token comes from Entra, and CWS still reads the user's roles from it.
 *
 * Must come AFTER provideCwsWorkspace on the route: the later provider wins.
 */
export const CWS_SAMPLE_DATA_PROVIDERS: Provider[] = [
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
