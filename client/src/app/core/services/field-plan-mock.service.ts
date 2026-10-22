import { Injectable, signal } from '@angular/core';
import { FieldSeason, ProducerField } from '@models';

/**
 * PROTOTYPE ONLY: in-memory stand-in for the fields API, so "fields under each crop row" can be
 * walked through with originators before any table or endpoint exists. Nothing is persisted and no
 * planting intention is ever written: a reload starts over. Every producer starts with no fields.
 *
 * Holds only what every field has (name, location, acres per crop row). Sustainability program data
 * lives in ProgramRecordMockService, one record per program per season.
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

  /** The field's most recent season before `year`: last time's acres, and the key to last time's program data. */
  lastSeason(fieldKey: string, year: number): FieldSeason | undefined {
    return this.seasons()
      .filter(s => s.fieldKey === fieldKey && s.year < year)
      .sort((a, b) => b.year - a.year)[0];
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Adds a field for a CTRM split. A split already known is returned as it is: one field per split. */
  createField(field: Omit<ProducerField, 'fieldKey'>): ProducerField {
    const existing = this.field(field.splitId);
    if (existing) return existing;
    const created: ProducerField = { ...field, fieldKey: field.splitId };
    this.fields.update(fs => [...fs, created]);
    return created;
  }

  updateField(field: ProducerField): void {
    this.fields.update(fs => fs.map(f => (f.fieldKey === field.fieldKey ? { ...field } : f)));
  }

  addSeason(fieldKey: string, intentionId: number, year: number, cropLabel: string, acres: number): FieldSeason {
    const season: FieldSeason = { id: `s${this._nextId++}`, fieldKey, plantingIntentionId: intentionId, year, cropLabel, acres };
    this.seasons.update(ss => [...ss, season]);
    return season;
  }

  updateSeason(season: FieldSeason): void {
    this.seasons.update(ss => ss.map(s => (s.id === season.id ? { ...season } : s)));
  }

  removeSeason(seasonId: string): void {
    this.seasons.update(ss => ss.filter(s => s.id !== seasonId));
  }
}
