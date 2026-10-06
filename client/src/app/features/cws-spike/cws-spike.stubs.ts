/*
 * Everything a host has to supply, in one file.
 *
 * The @cws/* libraries carry no data access of their own: every source is an InjectionToken the
 * host fills. That is design rule 2 of the proposal, and it is what lets this host run with no
 * API, no sign-in and no network at all.
 *
 * These are STUBS, not simulations. They return enough for the screen to render so that the
 * embedding mechanics - DI, theming, dark mode, the Tailwind @source line, routing - can be
 * exercised. They are not a second implementation of any business rule, and they must never
 * become one: a rule that lives in a host stub is a rule that can disagree with the API.
 */
import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpBackend, HttpErrorResponse, HttpEvent, HttpRequest } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';

import type {
  ApprovalActionResult,
  ApprovalActionSource,
  ApprovalContract,
  ApprovalContractSource,
  ContractAuditEntry,
  ContractLogSource,
  ContractPrices,
  ContractStateSource,
  ContractTemplate,
  ContractTemplateSource,
  FormConfigAdminSource,
  MarketMonthConfigRow,
  PricingSource,
  PricingWriteResult,
  TradeUnitValuesSource,
  UnapprovedPrices,
  ValueConfigurationRow,
  Availability,
  AvailabilitySource,
  ContractDetailResponse,
  ContractDetailSource,
  ContractNumberAvailability,
  ContractNumberSource,
  ContractWriteFields,
  ContractWriteResult,
  ContractWriteSource,
  IssueContractNumberRequest,
  IssuedContractNumber,
  LocationList,
  LocationSource,
  MarketReferenceSource,
} from '@cws/domain-contracts';
import type { PermissionContext, TradeUnitContext } from '@cws/core-state';
import type { AllowedValue } from '@cws/shared-form-engine';
import { remoteError, remoteLoaded, type RemoteData } from '@cws/shared-ui';

/** The trade unit the host has decided the user is working in. */
export const hostTradeUnit: TradeUnitContext = {
  code: () => '1234',
};

/*
 * The host answers what its user may do. Every one is true here so the screen renders its full
 * set of controls; flipping canWriteContracts to false is the cheapest way to see the gating.
 */
export const hostPermissions: PermissionContext = {
  canWriteContracts: () => true,
  canAccessAdmin: () => true,
  canApproveContracts: () => true,
  canEditPricing: () => true,
};

const sampleContract: ContractDetailResponse = {
  dataOrigin: 'Simulated',
  unmodelledCollections: [],
  warnings: ['Rendered from a host stub. No CTRM call was made.'],
  contract: {
    header: {
      contractNumber: 'SCW227618',
      tradeUnit: '1234',
      contractDate: '2026-09-01',
      customerId: '1004421',
      customerName: 'EXAMPLE GRAIN CO',
      customerContract: 'TEST123456',
      commodity: 'YC',
      quantity: 1875000,
      quantityUom: 'BU',
      unpricedQuantity: 875000,
      appliedQuantity: 0,
      openQuantity: 1875000,
      price: 4.25,
      basisPrice: -0.35,
      priceTypeCode: 'P',
      paymentTerms: 'NET30',
      marketZone: 'ZONE01',
      traderInitials: 'MKD',
      trader: 'M. DELGADO',
      originName: 'OMAHA NE',
      destinationName: 'COUNCIL BLUFFS IA',
      shipPeriodBegin: '2026-10-01',
      shipPeriodEnd: '2026-10-31',
      traderApprovalStatus: 'Approved',
      customerConfirmStatus: 'Pending',
      brokerConfirmStatus: 'Confirmed',
      // Added to ContractSummary after 2026-09-18. The host found it the way Originations would: the
      // built .d.ts refused a stub that no longer matched, before anything rendered.
      isClosed: false,
      isIntercompany: false,
    },
    version: '009',
    currency: 'USD',
    descriptiveQuantity: '1,875,000 BU',
    basisLocation: 'DLVD NE',
    shipPeriodDescription: 'OCT 2026',
    incoTermsDescription: 'DELIVERED',
    namedPlace: 'OMAHA NE',
    originCode: 'OMA',
    destinationCode: 'CBF',
    brokerId: null,
    brokerContract: null,
    customerMerchant: 'JOE',
    freightAdjustment: null,
    hedgePrice: 4.6,
    quantities: {
      unpriced: 875000,
      priced: 1000000,
      unshipped: 1875000,
      applied: 0,
      settled: 0,
      open: 1875000,
    },
    remarks: [{ order: 1, type: 'GEN', text: 'Rendered by the embedding host.' }],
    shipPeriods: [
      {
        order: 1,
        begin: '2026-10-01',
        end: '2026-10-31',
        latePickup: null,
        earlyDelivery: null,
        quantity: 1875000,
      },
    ],
    prices: [
      {
        sequence: 1,
        quantity: 1000000,
        flatPrice: 4.25,
        basisPrice: -0.35,
        hedgePrice: 4.6,
        freightAdjustment: null,
        marketMonth: 'Z26',
        marketMonthDescription: 'DEC 2026',
        priceDate: '2026-09-02',
        remark: null,
      },
    ],
    notes: [],
    origin: 1,
  },
};

@Injectable()
export class HostContractDetailSource implements ContractDetailSource {
  get(contractNumber: string): Observable<RemoteData<ContractDetailResponse>> {
    return of(
      remoteLoaded({
        ...sampleContract,
        contract: {
          ...sampleContract.contract,
          header: { ...sampleContract.contract.header, contractNumber },
        },
      }),
    );
  }
}

@Injectable()
export class HostContractNumberSource implements ContractNumberSource {
  issue(request: IssueContractNumberRequest): Observable<IssuedContractNumber> {
    const component = 'W227618';
    return of({
      numberComponent: component,
      contractNumber: request.prefixType + request.prefixCommodity + component,
      ctrmKey: request.prefixType + request.prefixCommodity + component,
      dataOrigin: 'Simulated',
      warnings: ['Host stub: no contract number was issued by CTRM.'],
    });
  }

  check(contractNumber: string): Observable<ContractNumberAvailability> {
    return of({
      contractNumber,
      isAvailable: true,
      conflict: '',
      dataOrigin: 'Simulated',
      warnings: [],
    });
  }
}

/*
 * A write the host accepts and does nothing with.
 *
 * 🔴 Deliberately reports Unknown rather than Created or Updated. On this estate CTRM answers 202
 * whatever it did, so the screen reads the create-versus-update discriminator out of the response
 * - and a stub that confidently claimed Updated would be asserting an outcome nothing observed.
 */
@Injectable()
export class HostContractWriteSource implements ContractWriteSource {
  fields(contractNumber: string): Observable<ContractWriteFields> {
    return of({ contractNumber, fields: {} });
  }

  create(): Observable<ContractWriteResult> {
    return of({
      contractNumber: 'SCW227618',
      action: 'Unknown',
      detail: 'Host stub: nothing was written. No CTRM call was made.',
      warnings: [],
    });
  }

  update(contractNumber: string): Observable<ContractWriteResult> {
    return of({
      contractNumber,
      action: 'Unknown',
      detail: 'Host stub: nothing was written. No CTRM call was made.',
      warnings: [],
    });
  }
}

/*
 * The pricing cascade's reference lists.
 *
 * ⚠ Returning null means "the lookup is still in flight or unavailable", which is a different
 * state from an empty array - an empty array is a settled answer of no rows, and the screen treats
 * the two differently on purpose. These return real rows so the cascade can be seen working.
 */
@Injectable()
export class HostMarketReferenceSource implements MarketReferenceSource {
  marketCodes(): Observable<readonly AllowedValue[] | null> {
    return of([
      { code: 'CBOT', description: 'CHICAGO BOARD OF TRADE' },
      { code: 'KCBT', description: 'KANSAS CITY BOARD OF TRADE' },
    ]);
  }

  marketMonths(): Observable<readonly AllowedValue[] | null> {
    return of([
      { code: 'Z26', description: 'DEC 2026' },
      { code: 'H27', description: 'MAR 2027' },
    ]);
  }
}

/*
 * 🔴 LOCATION_SOURCE is required and does NOT appear in ContractRecordPageComponent's own
 * inject() calls.
 *
 * It arrives transitively, through a child the screen renders. That matters more than the
 * line of code: it means a host CANNOT derive what it has to provide by reading the component
 * it is embedding. The real requirement is the transitive closure over every child component
 * and service, and nothing publishes that list.
 *
 * Found by running the host, not by reading the source - the static pass missed it.
 */
@Injectable()
export class HostLocationSource implements LocationSource {
  // Annotated rather than inferred: without it TypeScript widens the dataOrigin literal to
  // string and the object stops satisfying LocationList.
  private readonly locations: LocationList = {
    dataOrigin: 'Simulated',
    warnings: [],
    locations: [
      {
        code: '1234',
        name: 'HOST STUB LOCATION',
        companyCode: '10',
        companyName: 'THE SCOULAR COMPANY',
        divisionCode: '01',
        divisionName: 'GRAIN',
        customerId: null,
      },
    ],
  };

  list(): Observable<RemoteData<LocationList>> {
    return of(remoteLoaded(this.locations));
  }
}

/*
 * ─── The whole workspace (E9 PR 5, T5.2) ───────────────────────────────────────────────────────────
 *
 * `provideCwsWorkspace` wires an Http source behind every seam. Each stub below replaces one at the
 * host's `/workbench/cws` route, so the workspace renders with no API. Reads answer an empty settled
 * list; writes answer that nothing was written. Still STUBS: none of them decides anything.
 */

/** The text every stubbed write answers with, so nothing on screen can read as a real save. */
const NOTHING_WRITTEN = 'Host stub: nothing was written. No API call was made.';

/**
 * What the stub reports, as a ROOT token so a spec can set it for the whole page (T5.6); the source
 * itself sits on the workspace's route, where nothing at the root could otherwise reach it.
 */
export const HOST_AVAILABILITY = new InjectionToken<Availability>('HOST_AVAILABILITY', {
  providedIn: 'root',
  factory: () => ({ state: 'Available', message: null }),
});

@Injectable()
export class HostAvailabilitySource implements AvailabilitySource {
  private readonly answer = inject(HOST_AVAILABILITY);

  get(): Observable<Availability> {
    return of(this.answer);
  }
}

@Injectable()
export class HostContractLogSource implements ContractLogSource {
  audit(): Observable<RemoteData<readonly ContractAuditEntry[]>> {
    return of(remoteLoaded([]));
  }

  notifyTrader(): Observable<void> {
    return throwError(() => new Error(NOTHING_WRITTEN));
  }
}

@Injectable()
export class HostContractStateSource implements ContractStateSource {
  close(): Observable<ContractDetailResponse> {
    return throwError(() => new Error(NOTHING_WRITTEN));
  }

  reopen(): Observable<ContractDetailResponse> {
    return throwError(() => new Error(NOTHING_WRITTEN));
  }
}

@Injectable()
export class HostContractTemplateSource implements ContractTemplateSource {
  list(): Observable<RemoteData<readonly ContractTemplate[]>> {
    return of(remoteLoaded([]));
  }

  save(): Observable<ContractTemplate> {
    return throwError(() => new Error(NOTHING_WRITTEN));
  }

  rename(): Observable<ContractTemplate> {
    return throwError(() => new Error(NOTHING_WRITTEN));
  }

  remove(): Observable<void> {
    return throwError(() => new Error(NOTHING_WRITTEN));
  }
}

@Injectable()
export class HostPricingSource implements PricingSource {
  contractPrices(contract: string): Observable<RemoteData<ContractPrices>> {
    return of(remoteLoaded({ contract, prices: [] }));
  }

  unapproved(): Observable<RemoteData<UnapprovedPrices>> {
    return of(remoteLoaded({ prices: [], count: 0, truncationCeiling: 0, mayBeTruncated: false }));
  }

  save(): Observable<RemoteData<PricingWriteResult>> {
    return of(remoteError<PricingWriteResult>({ message: NOTHING_WRITTEN }));
  }

  remove(): Observable<RemoteData<PricingWriteResult>> {
    return of(remoteError<PricingWriteResult>({ message: NOTHING_WRITTEN }));
  }

  approve(): Observable<RemoteData<PricingWriteResult>> {
    return of(remoteError<PricingWriteResult>({ message: NOTHING_WRITTEN }));
  }
}

@Injectable()
export class HostTradeUnitValuesSource implements TradeUnitValuesSource {
  values(): Observable<readonly ValueConfigurationRow[]> {
    return of([]);
  }

  marketMonths(): Observable<readonly MarketMonthConfigRow[]> {
    return of([]);
  }
}

@Injectable()
export class HostApprovalContractSource implements ApprovalContractSource {
  get(contractNumber: string): Observable<RemoteData<ApprovalContract>> {
    return of(
      remoteLoaded<ApprovalContract>({
        header: { ...sampleContract.contract.header, contractNumber },
        dataOrigin: 'Simulated',
        warnings: ['Rendered from a host stub. No CTRM call was made.'],
      }),
    );
  }
}

@Injectable()
export class HostApprovalActionSource implements ApprovalActionSource {
  approve(): Observable<ApprovalActionResult> {
    return throwError(() => new Error(NOTHING_WRITTEN));
  }

  reject(): Observable<ApprovalActionResult> {
    return throwError(() => new Error(NOTHING_WRITTEN));
  }
}

/** The admin screen's list is empty; every other call answers that the host has no admin API. */
@Injectable()
export class HostFormConfigAdminSource implements FormConfigAdminSource {
  list() {
    return of(remoteLoaded({ rows: [], storeOrigin: 'Host stub' }));
  }

  auditTrail() {
    return of(remoteError<never>({ message: NOTHING_WRITTEN }));
  }

  registry() {
    return of(remoteError<never>({ message: NOTHING_WRITTEN }));
  }

  get() {
    return of(remoteError<never>({ message: NOTHING_WRITTEN }));
  }

  preview() {
    return of(remoteError<never>({ message: NOTHING_WRITTEN }));
  }

  create() {
    return of(remoteError<never>({ message: NOTHING_WRITTEN }));
  }

  update() {
    return of(remoteError<never>({ message: NOTHING_WRITTEN }));
  }

  deactivate() {
    return of(remoteError<never>({ message: NOTHING_WRITTEN }));
  }
}

/*
 * 🔴 The workspace's HttpBackend, replaced: nothing it sends leaves the page.
 *
 * Three seams cannot be overridden from the host's route at all, because the record routes provide
 * them on their own LAZY children (ADDENDUM_TEMPLATE_SOURCE, ADDENDUM_GENERATION_SOURCE,
 * CONTRACT_DOCUMENTS_SOURCE: a child route's providers win over its parent's). They still use the
 * workspace's HttpClient, and the interceptors still run, so the bearer is attached exactly as in
 * production; only the transport is cut. Each such call fails as a 503, which the screens render as
 * "not available" rather than as data.
 */
@Injectable()
export class HostOfflineBackend implements HttpBackend {
  /** Every request the workspace tried to send, for the specs. */
  readonly sent: HttpRequest<unknown>[] = [];

  handle(request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    this.sent.push(request);

    return throwError(
      () =>
        new HttpErrorResponse({
          url: request.urlWithParams,
          status: 503,
          statusText: 'Host stub: offline',
          error: { title: 'The embedding host is offline by design.', status: 503 },
        }),
    );
  }
}
