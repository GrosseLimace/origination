import { Injectable, signal } from '@angular/core';
import { FdCicCrop, FieldSeason, ProducerField, SeasonStatus } from './model';
import { missingInputs } from '@shared/utils/ci-illustrative';
import { CopyablePractices, practicesToCopy } from '@shared/utils/ci-copy-forward';

/** Last season's practices on a field, offered by "Copy last year's practices". */
export interface PriorPractices {
  year: number;
  crop: FdCicCrop;
  cropLabel: string;
  season: CopyablePractices;
}

/**
 * PROTOTYPE ONLY: in-memory stand-in for the 45Z API (api/carbonintensity), so the capture
 * screens can be walked through with originators before any table or endpoint exists. Nothing is
 * persisted; a reload starts over. Each producer is seeded with three sample fields (isSample,
 * labelled "Sample" on screen) and last year's practices so the reuse and copy-forward paths can be
 * tried. The real service replaces this class with HTTP calls behind the same signals and methods.
 */
@Injectable({ providedIn: 'root' })
export class BesideMockService {
  readonly fields = signal<ProducerField[]>([]);
  readonly seasons = signal<FieldSeason[]>([]);
  private readonly _prior = new Map<string, PriorPractices>();
  private readonly _seeded = new Set<number>();
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

  /** Set by clearAll(): skip the sample fields for the rest of the session (a reload brings them back). */
  private _samplesDisabled = false;

  /** Wipes every field, season and prior practice, and stops sample fields from being re-seeded. */
  clearAll(): void {
    this.fields.set([]);
    this.seasons.set([]);
    this._prior.clear();
    this._samplesDisabled = true;
  }

  /** Seeds a producer's fields once per session. */
  ensureLoaded(customerId: number, defaultState?: string): void {
    if (this._samplesDisabled || this._seeded.has(customerId)) return;
    this._seeded.add(customerId);
    const state = defaultState && this.countiesByState[defaultState] ? defaultState : 'KS';
    const county = this.countiesByState[state][0];
    const seeds: { name: string; acres: number; crop: FdCicCrop; cropLabel: string; tillage: FieldSeason['tillage']; cover: FieldSeason['coverCrop'] }[] = [
      { name: 'North 80', acres: 80, crop: 'Soybean', cropLabel: 'Soybeans', tillage: 'NoTill', cover: 'CoverCrop' },
      { name: 'River Bottom', acres: 320, crop: 'Corn', cropLabel: 'Corn', tillage: 'ReducedTill', cover: 'None' },
      { name: 'Home Place', acres: 200, crop: 'Corn', cropLabel: 'Corn', tillage: 'Conventional', cover: 'None' },
    ];
    const year = new Date().getFullYear();
    const created = seeds.map(s => {
      const field: ProducerField = { fieldKey: crypto.randomUUID(), customerId, name: s.name, state, county, acres: s.acres, isSample: true };
      this._prior.set(field.fieldKey, {
        year: year - 1,
        crop: s.crop,
        cropLabel: s.cropLabel,
        season: {
          expectedYield: s.crop === 'Corn' ? 205 : 58,
          syntheticN: s.crop === 'Corn' ? 175 : 0,
          niFraction: s.crop === 'Corn' ? 0.5 : 0,
          tillage: s.tillage,
          coverCrop: s.cover,
          manure: [],
        },
      });
      return field;
    });
    this.fields.update(fs => [...fs, ...created]);
  }

  fieldsFor(customerId: number): ProducerField[] {
    return this.fields().filter(f => f.customerId === customerId);
  }

  seasonsForIntention(intentionId: number): FieldSeason[] {
    return this.seasons().filter(s => s.plantingIntentionId === intentionId);
  }

  priorPractices(fieldKey: string): PriorPractices | undefined {
    return this._prior.get(fieldKey);
  }

  createField(field: Omit<ProducerField, 'fieldKey'>): ProducerField {
    const created = { ...field, fieldKey: crypto.randomUUID() };
    this.fields.update(fs => [...fs, created]);
    return created;
  }

  updateField(field: ProducerField): void {
    this.fields.update(fs => fs.map(f => (f.fieldKey === field.fieldKey ? { ...field } : f)));
  }

  /** Adds a field to an intention, prefilled from last year's practices when asked (see practicesToCopy). */
  addSeason(fieldKey: string, intentionId: number, crop: FdCicCrop, copyPrior: boolean): FieldSeason {
    const field = this.fields().find(f => f.fieldKey === fieldKey);
    const priorRecord = copyPrior ? this._prior.get(fieldKey) : undefined;
    const prior = priorRecord ? practicesToCopy(priorRecord.season, priorRecord.crop, crop) : undefined;
    const season: FieldSeason = {
      id: `s${this._nextId++}`,
      fieldKey,
      plantingIntentionId: intentionId,
      acres: field?.acres ?? null,
      expectedYield: prior?.expectedYield ?? null,
      actualYield: null,
      syntheticN: prior?.syntheticN ?? null,
      niFraction: prior?.niFraction ?? 0,
      tillage: prior?.tillage ?? null,
      coverCrop: prior?.coverCrop ?? null,
      manure: prior?.manure ?? [],
      status: 'Draft',
    };
    season.status = this._derivedStatus(season);
    this.seasons.update(ss => [...ss, season]);
    return season;
  }

  updateSeason(season: FieldSeason): void {
    if (season.status === 'Final') return;
    const next = { ...season, manure: season.manure.map(m => ({ ...m })) };
    next.status = this._derivedStatus(next);
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
      reopened.status = this._derivedStatus(reopened);
      return reopened;
    }));
  }

  private _derivedStatus(s: FieldSeason): SeasonStatus {
    return missingInputs(s).length === 0 ? 'Projected' : 'Draft';
  }
}
