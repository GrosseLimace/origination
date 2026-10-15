import { Injectable, signal } from '@angular/core';
import { FieldSeason, ProducerField, SeasonStatus } from '@models';
import { missingInputs } from '@shared/utils/ci-illustrative';

/**
 * PROTOTYPE ONLY: in-memory stand-in for the fields API, so "fields under each crop row" can be
 * walked through with originators before any table or endpoint exists. Nothing is persisted and no
 * planting intention is ever written: a reload starts over. Each producer gets three sample fields
 * (isSample, labelled "Sample") with last year's practices, so picking an existing field and
 * copy-forward can be tried.
 */
@Injectable({ providedIn: 'root' })
export class FieldPlanMockService {
  readonly fields = signal<ProducerField[]>([]);
  readonly seasons = signal<FieldSeason[]>([]);
  private readonly _seeded = new Set<number>();
  private _samplesDisabled = false;
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

  /** Seeds a producer's sample fields once per session. */
  ensureLoaded(customerId: number, defaultState?: string): void {
    if (this._samplesDisabled || this._seeded.has(customerId)) return;
    this._seeded.add(customerId);
    const state = defaultState && this.countiesByState[defaultState] ? defaultState : 'KS';
    const county = this.countiesByState[state][0];
    const lastYear = new Date().getFullYear() - 1;
    const seeds = [
      { name: 'North 80', acres: 80, cropLabel: 'Soybeans', tillage: 'NoTill' as const, cover: 'CoverCrop' as const },
      { name: 'River Bottom', acres: 320, cropLabel: 'Corn', tillage: 'ReducedTill' as const, cover: 'None' as const },
      { name: 'Home Place', acres: 200, cropLabel: 'Corn', tillage: 'Conventional' as const, cover: 'None' as const },
    ];
    const fields: ProducerField[] = [];
    const history: FieldSeason[] = [];
    for (const s of seeds) {
      const field: ProducerField = { fieldKey: crypto.randomUUID(), customerId, name: s.name, state, county, isSample: true };
      fields.push(field);
      const isCorn = s.cropLabel === 'Corn';
      // Last year's record only (intention id 0 = not on any row shown): feeds acres defaults and copy-forward.
      history.push({
        ...this._blank(field.fieldKey, 0, lastYear, s.cropLabel, s.acres),
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

  seasonsForIntention(intentionId: number): FieldSeason[] {
    return this.seasons().filter(s => s.plantingIntentionId === intentionId);
  }

  season(id: string): FieldSeason | undefined {
    return this.seasons().find(s => s.id === id);
  }

  /** The field's most recent record before `year`: last time's acres and practices. */
  lastSeason(fieldKey: string, year: number): FieldSeason | undefined {
    return this.seasons()
      .filter(s => s.fieldKey === fieldKey && s.year < year)
      .sort((a, b) => b.year - a.year)[0];
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  createField(field: Omit<ProducerField, 'fieldKey'>): ProducerField {
    const created = { ...field, fieldKey: crypto.randomUUID() };
    this.fields.update(fs => [...fs, created]);
    return created;
  }

  updateField(field: ProducerField): void {
    this.fields.update(fs => fs.map(f => (f.fieldKey === field.fieldKey ? { ...field } : f)));
  }

  addSeason(fieldKey: string, intentionId: number, year: number, cropLabel: string, acres: number): FieldSeason {
    const season = this._blank(fieldKey, intentionId, year, cropLabel, acres);
    this.seasons.update(ss => [...ss, season]);
    return season;
  }

  updateSeason(season: FieldSeason): void {
    if (this.season(season.id)?.status === 'Final') return;
    const next = { ...season, manure: season.manure.map(m => ({ ...m })) };
    next.status = missingInputs(next).length === 0 ? 'Projected' : 'Draft';
    this.seasons.update(ss => ss.map(s => (s.id === season.id ? next : s)));
  }

  removeSeason(seasonId: string): void {
    this.seasons.update(ss => ss.filter(s => s.id !== seasonId || s.status === 'Final'));
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
      reopened.status = missingInputs(reopened).length === 0 ? 'Projected' : 'Draft';
      return reopened;
    }));
  }

  /** Wipes every field and season and stops sample fields from being re-seeded until a reload. */
  clearAll(): void {
    this.fields.set([]);
    this.seasons.set([]);
    this._samplesDisabled = true;
  }

  private _blank(fieldKey: string, intentionId: number, year: number, cropLabel: string, acres: number): FieldSeason {
    return {
      id: `s${this._nextId++}`, fieldKey, plantingIntentionId: intentionId, year, cropLabel, acres,
      expectedYield: null, actualYield: null, syntheticN: null, niFraction: 0, tillage: null, coverCrop: null, manure: [],
      status: 'Draft',
    };
  }
}
