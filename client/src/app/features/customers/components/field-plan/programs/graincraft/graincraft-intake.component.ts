import { Component, effect, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldProgramRecord, FieldSeason, ProducerField } from '@models';
import { ProgramIntake } from '../program-def';
import { FieldPlanStore } from '../../store/field-plan.store';
import type { GrainCraftData } from './graincraft.program';

/** Common hard red winter varieties, offered as suggestions; any variety can be typed. */
const SUGGESTED_VARIETIES = ['SY Monument', 'Zenda', 'KS Providence', 'Bob Dole', 'Joe', 'AP Prolific', 'Strad CL Plus', 'WB4269'];

/** GrainCraft's input for one wheat field: the variety. Saves as it's typed. */
@Component({
  selector: 'app-graincraft-intake',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: '../../field-plan.css',
  template: `
    <fieldset [disabled]="disabled()" class="max-w-md space-y-1">
      <label class="block text-sm">
        <span class="text-gray-700 dark:text-gray-300">Wheat variety</span>
        <input class="ci-input" [class.ci-missing]="!variety.trim()" [attr.list]="'gc-varieties-' + record().id"
               [(ngModel)]="variety" (ngModelChange)="save()" placeholder="e.g. SY Monument" />
        <datalist [id]="'gc-varieties-' + record().id">
          @for (v of varieties; track v) { <option [value]="v"></option> }
        </datalist>
      </label>
      <p class="text-xs text-gray-500 dark:text-gray-400">GrainCraft needs the variety grown on each wheat field. The field's CTRM split, location and acres above are shared with every program.</p>
    </fieldset>
  `,
})
export class GrainCraftIntakeComponent implements ProgramIntake {
  private readonly store = inject(FieldPlanStore);

  readonly record = input.required<FieldProgramRecord>();
  readonly season = input.required<FieldSeason>();
  readonly field = input.required<ProducerField>();
  readonly disabled = input(false);

  readonly varieties = SUGGESTED_VARIETIES;
  variety = '';
  private _draftOf: string | null = null;

  constructor() {
    effect(() => {
      const r = this.record();
      const key = `${r.id}|${r.status}`;
      if (key !== this._draftOf) {
        this.variety = (r.data as GrainCraftData).variety;
        this._draftOf = key;
      }
    });
  }

  save(): void {
    if (this.disabled()) return;
    this.store.updateRecord(this.record().id, { variety: this.variety } satisfies GrainCraftData);
  }
}
