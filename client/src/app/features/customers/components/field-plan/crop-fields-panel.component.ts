import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldPlanMockService } from '@core/services/field-plan-mock.service';
import { Customer, FdCicCrop, FieldSeason, PlantingIntention } from '@models';
import { estimateCi, seasonStatus, summarizeIntention } from '@shared/utils/ci-illustrative';
import { FieldSeasonDialogComponent } from './field-season-dialog.component';

/**
 * The fields under one crop row. The row's acres stay the total (what the dashboard counts); fields
 * break it down. Adding a field pre-fills the acres not yet in a field, so a crop on one field needs
 * no extra typing. When the fields add up to more than the total, the row offers to update it — the
 * only way field data ever changes an intention, and it goes through the normal Edit dialog.
 */
@Component({
  selector: 'app-crop-fields-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldSeasonDialogComponent],
  templateUrl: './crop-fields-panel.component.html',
  styleUrl: './field-plan.css',
})
export class CropFieldsPanelComponent {
  readonly plan = inject(FieldPlanMockService);

  readonly intention = input.required<PlantingIntention>();
  readonly customer = input.required<Customer>();
  readonly cropLabel = input.required<string>();
  /** The FD-CIC crop when this row is scored for 45Z, else null. */
  readonly ciCrop = input<FdCicCrop | null>(null);
  /** Asks the table to open its Edit dialog with the total set to the field acres. */
  readonly updateTotal = output<number>();

  readonly expanded = signal(false);
  readonly seasons = computed(() => this.plan.seasonsForIntention(this.intention().id));
  readonly inFields = computed(() => this.seasons().reduce((sum, s) => sum + (s.acres ?? 0), 0));
  readonly remaining = computed(() => this.intention().acres - this.inFields());
  readonly summary = computed(() => {
    const crop = this.ciCrop();
    return crop ? summarizeIntention(crop, this.intention(), this.seasons()) : null;
  });

  toggle(): void {
    this.expanded.update(e => !e);
  }

  fieldName(s: FieldSeason): string {
    return this.plan.field(s.fieldKey)?.name ?? 'Field';
  }

  fieldPlace(s: FieldSeason): string {
    const f = this.plan.field(s.fieldKey);
    return f ? `${f.county}, ${f.state}` : '';
  }

  ci(s: FieldSeason) {
    const crop = this.ciCrop();
    return crop ? { result: estimateCi(crop, s), status: seasonStatus(s) } : null;
  }

  setAcres(s: FieldSeason, value: number): void {
    this.plan.updateSeason({ ...s, acres: Number(value) || 0 });
  }

  remove(s: FieldSeason): void {
    this.plan.removeSeason(s.id);
  }

  // ── Add a field: pick one of the producer's fields or type a new name ────────
  newName = '';
  newState = 'KS';
  newCounty = '';
  newAcres: number | null = null;

  /** The producer's fields not already on this row, for the name type-ahead. */
  readonly pickable = computed(() => {
    const used = new Set(this.seasons().map(s => s.fieldKey));
    return this.plan.fieldsFor(this.customer().id).filter(f => !used.has(f.fieldKey));
  });

  private get _match() {
    const name = this.newName.trim().toLowerCase();
    return name ? this.pickable().find(f => f.name.toLowerCase() === name) : undefined;
  }

  get isNewField(): boolean {
    return !!this.newName.trim() && !this._match;
  }

  openAdd(): void {
    const st = this.customer().stateProvince;
    this.newState = st && this.plan.countiesByState[st] ? st : 'KS';
    this.newCounty = this.plan.countiesByState[this.newState][0];
    this.newName = '';
    this.newAcres = this.remaining() > 0 ? this.remaining() : null;
  }

  /** Picking a known field pre-fills its acres from last time, capped at what's left to place. */
  onNameChange(): void {
    const match = this._match;
    if (!match) return;
    const last = this.plan.lastSeason(match.fieldKey, this.intention().plantingYear)?.acres ?? null;
    const left = this.remaining() > 0 ? this.remaining() : null;
    this.newAcres = last && left ? Math.min(last, left) : (last ?? left);
  }

  get canAdd(): boolean {
    return !!this.newName.trim() && (this.newAcres ?? 0) > 0 && (!this.isNewField || !!this.newCounty);
  }

  add(): void {
    if (!this.canAdd) return;
    const field = this._match ?? this.plan.createField({
      customerId: this.customer().id, name: this.newName.trim(), state: this.newState, county: this.newCounty,
    });
    const pi = this.intention();
    this.plan.addSeason(field.fieldKey, pi.id, pi.plantingYear, this.cropLabel(), this.newAcres!);
    this.openAdd(); // ready for the next field
  }

  countiesFor(state: string): string[] {
    return this.plan.countiesByState[state] ?? [];
  }

  openSeasonId: string | null = null;

  absPct(fraction: number | null): number {
    return Math.abs(Math.round((fraction ?? 0) * 100));
  }
}
