import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import type { components } from './api-types';

type S = components['schemas'];
export type Session = S['Session'];
export type TradeUnit = S['TradeUnit'];
export type TradeUnitGroup = S['TradeUnitGroup'];
export type TradeUnitStorage = S['TradeUnitStorage'];
export type CustomerSummary = S['CustomerSummary'];
export type CustomerDetail = S['CustomerDetail'];
export type Contact = S['Contact'];
export type ProducerDetails = S['ProducerDetails'];
export type ProducerDetailsUpdate = S['ProducerDetailsUpdate'];
export type ContactUpdate = S['ContactUpdate'];
export type GrainOnFarmItem = S['GrainOnFarmItem'];
export type BinSite = S['BinSite'];
export type RecentNotes = S['RecentNotes'];
export type Note = S['Note'];
export type NoteCreate = S['NoteCreate'];
export type ContractCard = S['ContractCard'];
export type ContractDetail = S['ContractDetail'];
export type TicketSummary = S['TicketSummary'];
export type PlantingIntention = S['PlantingIntention'];
export type PlantingIntentionCreate = S['PlantingIntentionCreate'];
export type PlantingIntentionUpdate = S['PlantingIntentionUpdate'];
export type StorageCard = S['StorageCard'];
export type DpContractCard = S['DpContractCard'];
export type Commodity = S['Commodity'];

/**
 * The ONLY HTTP surface of the mobile app: one method per operation in openapi/mobile/specification.yaml,
 * typed from the generated api-types.ts. There is deliberately no generic `get<T>(url)` — a screen
 * cannot call anything outside the contract, which is also exactly what APIM exposes.
 *
 * Regenerate types with `npx openapi-typescript ../openapi/mobile/specification.yaml -o
 * projects/mobile/src/app/core/api/api-types.ts` (CI fails when the committed file is stale).
 */
@Injectable({ providedIn: 'root' })
export class MobileApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl.replace(/\/+$/, '');

  // ---- session ------------------------------------------------------------------------------
  getSession(): Promise<Session> {
    return this.get<Session>('/me');
  }

  /** Card #648: whether each trade unit offers storage (drives the Storage & DP tab). */
  getTradeUnitStorage(tradeUnits: readonly string[]): Promise<TradeUnitStorage[]> {
    let params = new HttpParams();
    for (const tu of tradeUnits) params = params.append('tradeUnits', tu);
    return this.get<TradeUnitStorage[]>('/trade-units/storage', params);
  }

  // ---- customers (#641, #642) ---------------------------------------------------------------
  /** Without `q`: the producers in the given (or all entitled) trade units, by name. */
  searchCustomers(q?: string, tradeUnits?: readonly string[], limit?: number): Promise<CustomerSummary[]> {
    let params = new HttpParams();
    if (q && q.trim().length > 0) params = params.set('q', q.trim());
    for (const tu of tradeUnits ?? []) params = params.append('tradeUnits', tu);
    if (limit) params = params.set('limit', limit);
    return this.get<CustomerSummary[]>('/customers', params);
  }

  getCustomer(customerId: number): Promise<CustomerDetail> {
    return this.get<CustomerDetail>(`/customers/${customerId}`);
  }

  // ---- producer details (#643) --------------------------------------------------------------
  getProducerDetails(customerId: number): Promise<ProducerDetails> {
    return this.get<ProducerDetails>(`/customers/${customerId}/details`);
  }

  updateProducerDetails(customerId: number, body: ProducerDetailsUpdate): Promise<ProducerDetails> {
    return firstValueFrom(this.http.put<ProducerDetails>(`${this.base}/customers/${customerId}/details`, body));
  }

  // ---- notes (#644) -------------------------------------------------------------------------
  getRecentNotes(customerId: number, limit = 10): Promise<RecentNotes> {
    return this.get<RecentNotes>(`/customers/${customerId}/notes`, new HttpParams().set('limit', limit));
  }

  createNote(customerId: number, body: NoteCreate): Promise<Note> {
    return firstValueFrom(this.http.post<Note>(`${this.base}/customers/${customerId}/notes`, body));
  }

  // ---- contracts (#645) ---------------------------------------------------------------------
  getContractCards(customerId: number, includeClosed = false): Promise<ContractCard[]> {
    return this.get<ContractCard[]>(`/customers/${customerId}/contracts`, new HttpParams().set('includeClosed', includeClosed));
  }

  getContractDetail(customerId: number, contractId: number): Promise<ContractDetail> {
    return this.get<ContractDetail>(`/customers/${customerId}/contracts/${contractId}`);
  }

  // ---- tickets (#646) -----------------------------------------------------------------------
  getTicketSummary(customerId: number, cropYear?: number): Promise<TicketSummary> {
    const params = cropYear ? new HttpParams().set('cropYear', cropYear) : undefined;
    return this.get<TicketSummary>(`/customers/${customerId}/tickets/summary`, params);
  }

  // ---- planting intentions (#647) -----------------------------------------------------------
  getPlantingIntentions(customerId: number): Promise<PlantingIntention[]> {
    return this.get<PlantingIntention[]>(`/customers/${customerId}/planting-intentions`);
  }

  createPlantingIntention(customerId: number, body: PlantingIntentionCreate): Promise<PlantingIntention> {
    return firstValueFrom(this.http.post<PlantingIntention>(`${this.base}/customers/${customerId}/planting-intentions`, body));
  }

  updatePlantingIntention(customerId: number, intentionId: number, body: PlantingIntentionUpdate): Promise<PlantingIntention> {
    return firstValueFrom(this.http.put<PlantingIntention>(`${this.base}/customers/${customerId}/planting-intentions/${intentionId}`, body));
  }

  // ---- storage + DP (#648) ------------------------------------------------------------------
  getStorageCards(customerId: number): Promise<StorageCard[]> {
    return this.get<StorageCard[]>(`/customers/${customerId}/storage`);
  }

  getDpContractCards(customerId: number): Promise<DpContractCard[]> {
    return this.get<DpContractCard[]>(`/customers/${customerId}/dp-contracts`);
  }

  // ---- reference ----------------------------------------------------------------------------
  getPlantingCommodities(): Promise<Commodity[]> {
    return this.get<Commodity[]>('/reference/commodities');
  }

  // -------------------------------------------------------------------------------------------
  private get<T>(path: string, params?: HttpParams): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params }));
  }
}

/** RFC 4122 v4 id for idempotent mutations (`clientRequestId`). */
export function newClientRequestId(): string {
  return globalThis.crypto.randomUUID();
}
