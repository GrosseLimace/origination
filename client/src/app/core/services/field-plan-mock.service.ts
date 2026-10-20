import { Injectable, signal } from '@angular/core';
import { FieldSeason, ProducerField, SeasonStatus } from '@models';
import { missingInputs } from '@shared/utils/ci-illustrative';
import { CALCULATOR_VERSION, cloneIntake, emptyIntake, finalizeBlockers } from '@shared/utils/ci-enrollment';

/**
 * PROTOTYPE ONLY: in-memory stand-in for the fields API, so "fields under each crop row" can be
 * walked through with originators before any table or endpoint exists. Nothing is persisted and no
 * planting intention is ever written: a reload starts over. Every producer starts with no fields.
 */
@Injectable({ providedIn: 'root' })
export class FieldPlanMockService {
  readonly fields = signal<ProducerField[]>([]);
  readonly seasons = signal<FieldSeason[]>([]);
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
    const next = { ...season, manure: season.manure.map(m => ({ ...m })), ...cloneIntake(season) };
    next.status = missingInputs(next).length === 0 ? 'Projected' : 'Draft';
    this.seasons.update(ss => ss.map(s => (s.id === season.id ? next : s)));
  }

  removeSeason(seasonId: string): void {
    this.seasons.update(ss => ss.filter(s => s.id !== seasonId || s.status === 'Final'));
  }

  /** Locks the season with its actual yield and freezes the CI it was finalized at. Refused while the audit records are incomplete. */
  finalizeSeason(seasonId: string, actualYield: number, finalCiGPerBu: number): void {
    const season = this.seasons().find(s => s.id === seasonId);
    const field = season && this.fields().find(f => f.fieldKey === season.fieldKey);
    if (!season || !field || finalizeBlockers(season, field, actualYield).length > 0) return;
    this.seasons.update(ss => ss.map(s => (s.id === seasonId
      ? { ...s, actualYield, finalCiGPerBu, calculatorVersion: CALCULATOR_VERSION, status: 'Final' as SeasonStatus, finalizedBy: 'you', finalizedAt: new Date().toISOString() }
      : s)));
  }

  reopenSeason(seasonId: string): void {
    this.seasons.update(ss => ss.map(s => {
      if (s.id !== seasonId) return s;
      const reopened: FieldSeason = { ...s, status: 'Draft', finalizedBy: undefined, finalizedAt: undefined, finalCiGPerBu: undefined, calculatorVersion: undefined };
      reopened.status = missingInputs(reopened).length === 0 ? 'Projected' : 'Draft';
      return reopened;
    }));
  }

  private _blank(fieldKey: string, intentionId: number, year: number, cropLabel: string, acres: number): FieldSeason {
    return {
      id: `s${this._nextId++}`, fieldKey, plantingIntentionId: intentionId, year, cropLabel, acres,
      expectedYield: null, actualYield: null, syntheticN: null, niFraction: 0, tillage: null, coverCrop: null, manure: [],
      status: 'Draft',
      ...emptyIntake(),
    };
  }
}
