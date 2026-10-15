import { Injectable, computed, signal } from '@angular/core';
import { FALLOW, FieldSeason, PlantingIntention, ProducerField, SeasonStatus } from './model';
import { missingInputs } from '@shared/utils/ci-illustrative';
import { PlanKey, nextTotal, planKeyId, resolveKey } from './field-plan-rollup';

/** One simulated intention total: what the intention row would read once the plan is saved. */
export interface SimulatedTotal {
  key: PlanKey;
  cropLabel: string;
  /** Acres on the real intention when this session started (0 for a crop the plan adds). */
  baseline: number;
  total: number;
  /** The real intention row, when one exists. */
  intentionId: number | null;
}

/** Resolves a planting-category label ("Corn") to a commodity code and display label. */
export type CropResolver = (label: string) => { code: string; label: string } | null;

/**
 * PROTOTYPE ONLY: in-memory stand-in for the field-plan API (api/fieldplans), so "plan by field" can
 * be walked through with originators before any table or endpoint exists. Nothing is persisted and
 * real planting intentions are never written: the roll-up into intention totals is SIMULATED from
 * the producer's real totals at the start of the session, and the screens label it as not saved.
 * Each producer gets three sample fields (isSample) with a planting history for the year before, so
 * rotation suggestions and copy-forward can be tried. A reload starts over.
 */
@Injectable({ providedIn: 'root' })
export class ByFieldMockService {
  readonly fields = signal<ProducerField[]>([]);
  readonly seasons = signal<FieldSeason[]>([]);
  readonly totals = signal<Record<string, SimulatedTotal>>({});
  private _intentions: PlantingIntention[] = [];
  private readonly _seeded = new Set<number>();
  // DEMO: no sample fields — every producer starts empty.
  private _samplesDisabled = true;
  private _nextId = 1;

  /** A short county list per state; the real list comes from the FD-CIC county table. */
  readonly countiesByState: Record<string, string[]> = {
    IA: ['Polk', 'Story', 'Boone', 'Hamilton', 'Hardin', 'Marshall'],
    IL: ['Champaign', 'McLean', 'Livingston', 'Iroquois', 'LaSalle'],
    KS: ['Pratt', 'Kingman', 'Stafford', 'Reno', 'Barton', 'Greeley', 'Wichita'],
    MN: ['Renville', 'Redwood', 'Faribault', 'Martin'],
    NE: ['Hall', 'Buffalo', 'Adams', 'York', 'Hamilton'],
    ND: ['Cass', 'Richland', 'Traill', 'Cavalier'],
    SD: ['Brown', 'Spink', 'Beadle', 'Minnehaha'],
  };
  get states(): string[] { return Object.keys(this.countiesByState); }

  readonly hasAnyData = computed(() => this.fields().length > 0);

  // ── Loading ───────────────────────────────────────────────────────────────

  /**
   * Records the producer's real intentions as the starting totals (once per key, so later reads of
   * the same rows don't overwrite the simulation) and seeds the sample fields on first visit.
   */
  load(customerId: number, intentions: PlantingIntention[], year: number, defaultState: string | undefined, defaultTradeUnit: string, resolveCrop: CropResolver): void {
    this._intentions = intentions;
    this.totals.update(t => {
      const next = { ...t };
      for (const pi of intentions) {
        const key = { crop: pi.crop, type: pi.type || '', year: pi.plantingYear, tradeUnit: pi.tradeUnit || '' };
        const id = this.totalId(customerId, planKeyId(key));
        if (!next[id]) next[id] = { key, cropLabel: '', baseline: pi.acres, total: pi.acres, intentionId: pi.id };
      }
      return next;
    });
    if (this._samplesDisabled || this._seeded.has(customerId)) return;
    this._seeded.add(customerId);
    this._seedSamples(customerId, year, defaultState, defaultTradeUnit, resolveCrop);
  }

  private _seedSamples(customerId: number, year: number, defaultState: string | undefined, tradeUnit: string, resolveCrop: CropResolver): void {
    const state = defaultState && this.countiesByState[defaultState] ? defaultState : 'KS';
    const county = this.countiesByState[state][0];
    const corn = resolveCrop('Corn');
    const soy = resolveCrop('Soybeans');
    const seeds = [
      { name: 'North 80', acres: 80, irrigation: 'Irrigated' as const, last: soy, tillage: 'NoTill' as const, cover: 'CoverCrop' as const },
      { name: 'River Bottom', acres: 320, irrigation: 'Dryland' as const, last: corn, tillage: 'ReducedTill' as const, cover: 'None' as const },
      { name: 'Home Place', acres: 200, irrigation: 'Dryland' as const, last: corn, tillage: 'Conventional' as const, cover: 'None' as const },
    ];
    const fields: ProducerField[] = [];
    const history: FieldSeason[] = [];
    for (const s of seeds) {
      const field: ProducerField = {
        fieldKey: crypto.randomUUID(), customerId, name: s.name, acres: s.acres, irrigation: s.irrigation,
        state, county, tradeUnit, isSample: true,
      };
      fields.push(field);
      if (!s.last) continue;
      const isCorn = s.last === corn;
      // Last year's history only: it feeds the "2025" column, rotation suggestions and copy-forward.
      // It is not rolled into any total — those years' intentions are what they are.
      history.push({
        ...this._blankSeason(field, year - 1, s.last.code, s.last.label, s.irrigation, 1),
        expectedYield: isCorn ? 205 : 58, syntheticN: isCorn ? 175 : 0, niFraction: isCorn ? 0.5 : 0,
        tillage: s.tillage, coverCrop: s.cover, status: 'Projected',
      });
    }
    this.fields.update(fs => [...fs, ...fields]);
    this.seasons.update(ss => [...ss, ...history]);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  fieldsFor(customerId: number): ProducerField[] {
    return this.fields().filter(f => f.customerId === customerId);
  }

  field(fieldKey: string): ProducerField | undefined {
    return this.fields().find(f => f.fieldKey === fieldKey);
  }

  seasonsFor(fieldKey: string, year: number): FieldSeason[] {
    return this.seasons().filter(s => s.fieldKey === fieldKey && s.year === year).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  season(id: string): FieldSeason | undefined {
    return this.seasons().find(s => s.id === id);
  }

  /** The field's main crop the year before, for the history column, suggestions and copy-forward. */
  priorSeason(fieldKey: string, year: number): FieldSeason | undefined {
    return this.seasonsFor(fieldKey, year - 1)[0];
  }

  /** The intention key a season rolls up under (its matching real row when one exists). */
  keyFor(s: Pick<FieldSeason, 'crop' | 'type' | 'year' | 'tradeUnit'>): PlanKey {
    return resolveKey(this._intentions, { crop: s.crop, type: s.type, year: s.year, tradeUnit: s.tradeUnit });
  }

  /** Field acres per intention key for a year. */
  fieldAcresByKey(year: number, customerId: number): Map<string, number> {
    const keys = new Set(this.fieldsFor(customerId).map(f => f.fieldKey));
    const out = new Map<string, number>();
    for (const s of this.seasons()) {
      if (s.year !== year || s.crop === FALLOW || !keys.has(s.fieldKey)) continue;
      const id = planKeyId(this.keyFor(s));
      out.set(id, (out.get(id) ?? 0) + (s.acres ?? 0));
    }
    return out;
  }

  /** Totals are per producer: the plan key alone (crop, type, year, trade unit) repeats across producers. */
  totalId(customerId: number, planKeyIdValue: string): string {
    return `${customerId}#${planKeyIdValue}`;
  }

  /** This producer's simulated totals for a year. */
  totalsFor(customerId: number, year: number): SimulatedTotal[] {
    const prefix = `${customerId}#`;
    return Object.entries(this.totals())
      .filter(([id, t]) => id.startsWith(prefix) && t.key.year === year)
      .map(([, t]) => t);
  }

  /** The simulated total for one intention row, or undefined before the plan has loaded. */
  totalForIntention(pi: PlantingIntention): SimulatedTotal | undefined {
    const key = { crop: pi.crop, type: pi.type || '', year: pi.plantingYear, tradeUnit: pi.tradeUnit || '' };
    return this.totals()[this.totalId(pi.customerId, planKeyId(key))];
  }

  /** Sets a total's other acres directly; the field acres stay as they are. */
  setOtherAcres(customerId: number, key: PlanKey, other: number): void {
    const fieldAcres = this.fieldAcresByKey(key.year, customerId).get(planKeyId(key)) ?? 0;
    const tid = this.totalId(customerId, planKeyId(key));
    this.totals.update(t => (t[tid] ? { ...t, [tid]: { ...t[tid], total: fieldAcres + Math.max(Number(other) || 0, 0) } } : t));
  }

  // ── Writes (every acre change goes through _applyAcres so totals follow the roll-up rule) ──

  /** Sets a field's crop for the year. sortOrder 2 is the double crop. FALLOW clears the acres from any total. */
  setCrop(field: ProducerField, year: number, sortOrder: number, crop: string, cropLabel: string): void {
    const existing = this.seasonsFor(field.fieldKey, year).find(s => s.sortOrder === sortOrder);
    if (existing?.status === 'Final') return;
    const type = sortOrder === 2 ? 'Double Crop' : field.irrigation;
    this._applyAcres(field.customerId, year, () => {
      if (existing) {
        if (existing.crop === crop) return;
        // A new crop starts with blank practices: last crop's yield and N don't carry over.
        const replaced = { ...this._blankSeason(field, year, crop, cropLabel, type, sortOrder), id: existing.id, acres: existing.acres };
        this.seasons.update(ss => ss.map(s => (s.id === existing.id ? replaced : s)));
      } else {
        this.seasons.update(ss => [...ss, this._blankSeason(field, year, crop, cropLabel, type, sortOrder)]);
      }
    });
  }

  removeSeason(seasonId: string): void {
    const s = this.season(seasonId);
    const field = s && this.field(s.fieldKey);
    if (!s || !field || s.status === 'Final') return;
    this._applyAcres(field.customerId, s.year, () => this.seasons.update(ss => ss.filter(x => x.id !== seasonId)));
  }

  /** Saves a season edited in the detail panel; acre changes roll up like any other. */
  updateSeason(season: FieldSeason): void {
    const current = this.season(season.id);
    const field = current && this.field(current.fieldKey);
    if (!current || !field || current.status === 'Final') return;
    const next = { ...season, manure: season.manure.map(m => ({ ...m })) };
    next.status = this._derivedStatus(next);
    this._applyAcres(field.customerId, season.year, () => this.seasons.update(ss => ss.map(s => (s.id === season.id ? next : s))));
  }

  createField(field: Omit<ProducerField, 'fieldKey'>): ProducerField {
    const created = { ...field, fieldKey: crypto.randomUUID() };
    this.fields.update(fs => [...fs, created]);
    return created;
  }

  /** Field edits re-key its seasons' trade unit and type, so they roll up like an acre change. */
  updateField(field: ProducerField, year: number): void {
    this._applyAcres(field.customerId, year, () => {
      this.fields.update(fs => fs.map(f => (f.fieldKey === field.fieldKey ? { ...field } : f)));
      this.seasons.update(ss => ss.map(s => (s.fieldKey !== field.fieldKey || s.year !== year || s.status === 'Final') ? s : {
        ...s, tradeUnit: field.tradeUnit, type: s.sortOrder === 2 ? 'Double Crop' : field.irrigation,
      }));
    });
  }

  finalizeSeason(seasonId: string, actualYield: number): void {
    this.seasons.update(ss => ss.map(s => (s.id === seasonId
      ? { ...s, actualYield, status: 'Final' as SeasonStatus, finalizedBy: 'you', finalizedAt: new Date().toISOString() }
      : s)));
  }

  reopenSeason(seasonId: string): void {
    this.seasons.update(ss => ss.map(s => {
      if (s.id !== seasonId) return s;
      const reopened: FieldSeason = { ...s, status: 'Draft', finalizedBy: undefined, finalizedAt: undefined };
      reopened.status = this._derivedStatus(reopened);
      return reopened;
    }));
  }

  /** Wipes every field and season, puts every total back to its real value, and stops re-seeding samples. */
  clearAll(): void {
    this.fields.set([]);
    this.seasons.set([]);
    this.totals.update(t => {
      const reset: Record<string, SimulatedTotal> = {};
      for (const [id, row] of Object.entries(t)) if (row.baseline > 0) reset[id] = { ...row, total: row.baseline };
      return reset;
    });
    this._samplesDisabled = true;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Runs a change and moves each affected intention total by the roll-up rule (nextTotal). */
  private _applyAcres(customerId: number, year: number, change: () => void): void {
    const before = this.fieldAcresByKey(year, customerId);
    const keysBefore = this._keysByIdForYear(year, customerId);
    change();
    const after = this.fieldAcresByKey(year, customerId);
    const keys = { ...keysBefore, ...this._keysByIdForYear(year, customerId) };
    this.totals.update(t => {
      const next = { ...t };
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const b = before.get(id) ?? 0;
        const a = after.get(id) ?? 0;
        if (a === b) continue;
        const tid = this.totalId(customerId, id);
        const row = next[tid] ?? { key: keys[id].key, cropLabel: keys[id].label, baseline: 0, total: 0, intentionId: null };
        next[tid] = { ...row, cropLabel: row.cropLabel || keys[id].label, total: nextTotal(row.total, b, a) };
      }
      return next;
    });
  }

  private _keysByIdForYear(year: number, customerId: number): Record<string, { key: PlanKey; label: string }> {
    const keys = new Set(this.fieldsFor(customerId).map(f => f.fieldKey));
    const out: Record<string, { key: PlanKey; label: string }> = {};
    for (const s of this.seasons()) {
      if (s.year !== year || s.crop === FALLOW || !keys.has(s.fieldKey)) continue;
      const key = this.keyFor(s);
      out[planKeyId(key)] = { key, label: s.cropLabel };
    }
    return out;
  }

  private _blankSeason(field: ProducerField, year: number, crop: string, cropLabel: string, type: string, sortOrder: number): FieldSeason {
    return {
      id: `s${this._nextId++}`, fieldKey: field.fieldKey, year, crop, cropLabel, type, tradeUnit: field.tradeUnit,
      acres: crop === FALLOW ? null : field.acres, sortOrder,
      expectedYield: null, actualYield: null, syntheticN: null, niFraction: 0, tillage: null, coverCrop: null, manure: [],
      status: 'Draft',
    };
  }

  private _derivedStatus(s: FieldSeason): SeasonStatus {
    return missingInputs(s).length === 0 ? 'Projected' : 'Draft';
  }
}
