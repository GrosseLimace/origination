import { Injectable, inject } from '@angular/core';
import { FdCicData, FieldProgramRecord, FieldSeason, FieldTicket, FieldTickets, OfficialResult, ProducerField, ProgramRecordStatus } from '@models';
import { ProgramRegistry } from '../programs/program-registry';
import type { ConfirmReview, FieldPlanBackend, FieldPlanSnapshot } from './field-plan-backend';
import { CROP_GROUP_BY_TOKEN } from '../../../../../shared/utils/crop-group-match';
import { FD_CIC_PROGRAM_KEY } from '../programs/fd-cic/fd-cic.program';
import { TILLAGE_LABELS } from '../programs/fd-cic/fd-cic.data';
import { TDISC_TILLAGE, passesProblem, rateTDisc, supportedTillage, tDiscNeeded } from '../programs/fd-cic/fd-cic-tdisc';
import { TDiscApiService } from '@core/services/tdisc-api.service';
import { MsalService } from '@azure/msal-angular';

/** The server's crop groups (FieldPlanCropGroups.Codes); CROP_GROUP_BY_TOKEN also knows crops it doesn't. */
const SERVER_CROP_GROUPS = new Set(['wheat', 'corn', 'soybeans', 'sorghum', 'canola']);

/** As the server's FieldPlanCropGroups.ForLabel: the crop group named by any word of a crop row label. */
function cropGroupOfLabel(label: string): string | null {
  for (const word of label.toLowerCase().split(/[\s\-/()]+/).filter(Boolean)) {
    const group = CROP_GROUP_BY_TOKEN.get(word) ?? CROP_GROUP_BY_TOKEN.get(word.replace(/s$/, ''));
    if (group && SERVER_CROP_GROUPS.has(group)) return group;
  }
  return null;
}

/** A deep copy, as a JSON round trip, the way data comes back from the API (undefined fields drop out). */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * PROTOTYPE ONLY: plays the field-plan server in the browser until the database is approved. It holds
 * every producer's fields, seasons and program records in memory (a reload starts over)
 * and enforces the rules the real server will own, such as locking.
 * Everything handed out is a copy, as if it had come over the wire.
 */
@Injectable({ providedIn: 'root' })
export class InMemoryFieldPlanBackend implements FieldPlanBackend {
  private readonly registry = inject(ProgramRegistry);
  private readonly tDiscApi = inject(TDiscApiService);
  private readonly msal = inject(MsalService, { optional: true });

  /** The signed-in originator, as the API records them: the UPN, and the display name for documents. */
  private me(): { by: string; name: string } {
    const account = this.msal?.instance.getActiveAccount() ?? this.msal?.instance.getAllAccounts()[0];
    return { by: account?.username || 'you', name: account?.name?.trim() || account?.username || 'you' };
  }

  private fields: ProducerField[] = [];
  private seasons: FieldSeason[] = [];
  private records: FieldProgramRecord[] = [];
  private nextSeasonId = 1;
  private nextRecordId = 1;

  async load(customerId: number): Promise<FieldPlanSnapshot> {
    const fields = this.fields.filter(f => f.customerId === customerId);
    const keys = new Set(fields.map(f => f.fieldKey));
    const seasons = this.seasons.filter(s => keys.has(s.fieldKey));
    const seasonIds = new Set(seasons.map(s => s.id));
    return copy({
      fields,
      seasons,
      records: this.records.filter(r => seasonIds.has(r.seasonId)),
    });
  }

  // ── Fields and seasons ───────────────────────────────────────────────────

  /** A field is one CTRM split, so its key is the split ID, and a split is one producer's field. */
  async createField(field: Omit<ProducerField, 'fieldKey'>): Promise<ProducerField> {
    const splitId = field.splitId.trim().toUpperCase();
    const existing = this.fields.find(f => f.fieldKey === splitId);
    if (existing && existing.customerId !== field.customerId) throw new Error(`Split ${splitId} is another producer's field.`);
    if (existing) return copy(existing);
    // SPLITS-GRAPHQL: like the server's manual source, a split not from CTRM is kept as typed.
    const created: ProducerField = { ...copy(field), splitId, fieldKey: splitId, splitSource: field.splitSource ?? 'Manual' };
    this.fields.push(created);
    return copy(created);
  }

  /** The location; and for a split typed by hand, its name and share. A CTRM split's are CTRM's; the split ID never changes. */
  async updateField(field: ProducerField): Promise<ProducerField> {
    const i = this.indexOf(this.fields, f => f.fieldKey === field.fieldKey, 'field');
    const manual = this.fields[i].splitSource !== 'Ctrm';
    this.fields[i] = {
      ...this.fields[i], state: field.state, county: field.county,
      ...(manual ? { name: field.name.trim() || this.fields[i].splitId, splitPercent: field.splitPercent } : {}),
    };
    return copy(this.fields[i]);
  }

  async addSeason(season: Omit<FieldSeason, 'id'>): Promise<FieldSeason> {
    const field = this.fields[this.indexOf(this.fields, f => f.fieldKey === season.fieldKey, 'field')];
    // As the server: one field grows a crop once a year, so its tickets are never claimed twice.
    const group = cropGroupOfLabel(season.cropLabel);
    const sameCrop = this.seasons.find(s => s.fieldKey === season.fieldKey && s.year === season.year
      && (s.plantingIntentionId === season.plantingIntentionId || (group !== null && cropGroupOfLabel(s.cropLabel) === group)));
    if (sameCrop) throw new Error(`${field.name} is already on the ${sameCrop.cropLabel} row for ${season.year}.`);
    const created: FieldSeason = { ...copy(season), id: `s${this.nextSeasonId++}` };
    this.seasons.push(created);
    return copy(created);
  }

  async updateSeason(season: FieldSeason): Promise<FieldSeason> {
    const i = this.indexOf(this.seasons, s => s.id === season.id, 'season');
    if (this.records.some(r => r.seasonId === season.id && r.status === 'Locked')) {
      throw new Error('This field\'s CI is confirmed, so its acres can\'t change.');
    }
    this.seasons[i] = copy(season);
    return copy(season);
  }

  async removeSeason(seasonId: string): Promise<void> {
    if (this.records.some(r => r.seasonId === seasonId && r.status === 'Locked')) {
      throw new Error('This field\'s CI is confirmed, so it can\'t come off the crop row.');
    }
    this.records = this.records.filter(r => r.seasonId !== seasonId);
    this.seasons = this.seasons.filter(s => s.id !== seasonId);
  }

  // ── Program records ─────────────────────────────────────────────────────

  async addRecord(record: Omit<FieldProgramRecord, 'id'>): Promise<FieldProgramRecord> {
    this.indexOf(this.seasons, s => s.id === record.seasonId, 'season');
    const existing = this.records.find(r => r.seasonId === record.seasonId && r.programKey === record.programKey);
    if (existing) return copy(existing);
    const created: FieldProgramRecord = { ...copy(record), id: `r${this.nextRecordId++}` };
    this.records.push(created);
    return copy(created);
  }

  async updateRecord(id: string, data: unknown, status: ProgramRecordStatus, copiedFromField?: string): Promise<FieldProgramRecord> {
    const i = this.indexOf(this.records, r => r.id === id, 'program record');
    if (this.records[i].status === 'Locked') throw new Error('This field\'s CI is confirmed; unlock it to make changes.');
    if (status === 'Locked') throw new Error('A field is locked by confirming it after harvest, not by saving.');
    this.records[i] = { ...this.records[i], data: copy(data), status, ...(copiedFromField ? { copiedFromField } : {}) };
    return copy(this.records[i]);
  }

  async removeRecord(id: string): Promise<void> {
    this.records = this.records.filter(r => r.id !== id || r.status === 'Locked');
  }

  async reopen(id: string, reason: string): Promise<FieldProgramRecord> {
    const i = this.indexOf(this.records, r => r.id === id, 'program record');
    const current = this.records[i];
    if (current.status !== 'Locked' || !current.frozen) throw new Error('Only a confirmed CI can be unlocked.');
    if (!reason.trim()) throw new Error('Give a reason for reopening.');

    const season = this.seasons.find(s => s.id === current.seasonId)!;
    const def = this.registry.get(current.programKey);
    // A confirmed CI is unlocked with its estimate: both go to the history, and the field can be reviewed again.
    const reopened: FieldProgramRecord = {
      ...current,
      frozen: undefined,
      official: undefined,
      status: def && def.missing(current.data, season).length === 0 ? 'Ready' : 'Draft',
      reopened: [...(current.reopened ?? []), {
        reason: reason.trim(), at: new Date().toISOString(), frozen: current.frozen, ...(current.official ? { official: current.official } : {}),
      }],
    };
    this.records[i] = reopened;
    return copy(reopened);
  }

  /**
   * PROTOTYPE ONLY: made-up deliveries for a demo without CTRM. Four tickets under the split in the crop
   * year's harvest, adding up to about the field's expected production; the second is settled. One more,
   * delivered in July before the window opens, is offered to add.
   */
  async fieldTickets(id: string): Promise<FieldTickets> {
    const record = this.records[this.indexOf(this.records, r => r.id === id, 'program record')];
    const season = this.seasons.find(s => s.id === record.seasonId)!;
    const field = this.fields.find(f => f.fieldKey === season.fieldKey)!;
    const expected = (record.data as { expectedYield?: number | null }).expectedYield ?? 180;
    const each = Math.round(((season.acres ?? 100) * expected) / 4);
    const day = (n: number) => `${season.year}-10-${String(n).padStart(2, '0')}`;
    const tickets: FieldTicket[] = [4, 9, 15, 22].map((d, i) => ({
      ticketKey: `${field.splitId}-${season.year}-${i + 1}`, ticketNumber: `S${season.year % 100}${field.splitId.slice(-2)}${i + 1}`,
      blDate: day(d), location: 'Sample elevator', productCode: null, contractNumber: i === 1 ? 'P00001' : null,
      cropYearMatch: i === 1 ? 'contract' : 'window', netBushels: each + i * 7,
      settled: i === 1, settledDate: i === 1 ? day(28) : null, status: i === 1 ? 'Final Settled' : 'Unload',
    }));
    const others: FieldTicket[] = [{
      ticketKey: `${field.splitId}-${season.year}-early`, ticketNumber: `S${season.year % 100}${field.splitId.slice(-2)}0`,
      blDate: `${season.year}-07-28`, location: 'Sample elevator', productCode: null, contractNumber: null,
      cropYearMatch: 'other', note: `BL date outside 8/1/${season.year % 100}–7/31/${(season.year + 1) % 100}`,
      netBushels: Math.round(each / 3), settled: false, settledDate: null, status: 'Unload',
    }];
    return copy({ splitId: field.splitId, cropYear: season.year, cropGroup: null, windowFrom: `${season.year}-08-01`, windowTo: `${season.year + 1}-07-31`, tickets, others });
  }

  /**
   * As the server: the T-DISC rating checked against the tillage, the actual yield set, rescored (here: the
   * program's freeze) and locked, the confirmed CI kept as the official result.
   */
  async confirm(id: string, actualYield: number, ticketKeys: readonly string[], review: ConfirmReview): Promise<FieldProgramRecord> {
    const i = this.indexOf(this.records, r => r.id === id, 'program record');
    const current = this.records[i];
    if (current.programKey !== FD_CIC_PROGRAM_KEY) throw new Error('Only a 45Z field is confirmed with its tickets.');
    if (current.official) throw new Error('This field\'s CI is already confirmed; unlock it to review it again.');
    if (!review.recordkeepingReviewed) throw new Error('Confirm that the recordkeeping requirements were reviewed with the producer.');
    const keys = new Set(ticketKeys.map(k => k.trim()).filter(Boolean));
    if (!keys.size) throw new Error('Include at least one ticket.');
    const found = await this.fieldTickets(id);
    const included = [
      ...found.tickets.filter(t => keys.has(t.ticketKey)),
      ...(found.others ?? []).filter(t => keys.has(t.ticketKey)).map(t => ({ ...t, cropYearMatch: 'added' as const })),
    ];
    if (included.length !== keys.size) throw new Error('Some of those tickets are no longer this field\'s; reopen the review and try again.');
    const counted = included.find(t => t.confirmedFor != null);
    if (counted) throw new Error(`Ticket ${counted.ticketNumber} is already counted in this field's ${counted.confirmedFor} confirmed CI; leave it out.`);
    const unweighed = included.find(t => t.netBushels === null);
    if (unweighed) throw new Error(`Ticket ${unweighed.ticketNumber} has no bushel figure, so it can't be counted; leave it out.`);
    const season = this.seasons.find(s => s.id === current.seasonId)!;
    const field = this.fields.find(f => f.fieldKey === season.fieldKey)!;
    const def = this.registry.get(current.programKey)!;
    const estimate = current.data as FdCicData;
    // Only the rating worked out here counts, as on the server.
    let data: FdCicData = { ...estimate, actualYield, tDiscRating: null, tDiscPasses: null };
    let tDisc: OfficialResult['tDisc'] = null;
    if (tDiscNeeded(estimate.tillage)) {
      const passes = review.tDiscPasses ?? [];
      if (!passes.length) throw new Error('Add the field\'s passes for T-DISC (No till and Reduced till need a T-DISC rating).');
      const options = await this.tDiscApi.load();
      const result = rateTDisc(options, passes);
      if (!result) throw new Error(passesProblem(options, passes) ?? 'These passes can\'t be rated.');
      const tillage = supportedTillage(estimate.tillage, result.designation);
      data = { ...data, tillage, tDiscRating: result.rating, tDiscPasses: passes.map(p => ({ ...p })) };
      tDisc = {
        rating: result.rating, designation: TILLAGE_LABELS[TDISC_TILLAGE[result.designation]],
        estimatedTillage: TILLAGE_LABELS[estimate.tillage], confirmedTillage: TILLAGE_LABELS[tillage],
        version: options.label, windows: result.windows, passes: result.passes,
      };
    }
    const at = new Date().toISOString();
    const me = this.me();
    const frozen = { ...def.freeze(data, season, field), basis: 'Estimate' as const, lockedBy: me.by, lockedAt: at };
    this.records[i] = {
      ...current, data, status: 'Locked', frozen,
      official: {
        status: 'Documented', score: frozen.score, method: frozen.calculatorVersion, actualYield,
        bushels: included.reduce((sum, t) => sum + (t.netBushels ?? 0), 0), tickets: included,
        tDisc, recordkeepingAcknowledged: true, documentedBy: me.by, documentedByName: me.name, documentedAt: at,
      },
    };
    return copy(this.records[i]);
  }

  private indexOf<T>(items: T[], match: (item: T) => boolean, what: string): number {
    const i = items.findIndex(match);
    if (i < 0) throw new Error(`That ${what} no longer exists.`);
    return i;
  }
}
