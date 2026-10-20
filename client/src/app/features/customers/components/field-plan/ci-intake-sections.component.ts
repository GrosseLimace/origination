import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CiIntakeFields, EvidenceKind, NApplication, NEfficiency, NProduct, NTiming, OnFarmEnergy } from '@models';
import { EVIDENCE_LABELS, N_EFFICIENCY_LABELS, N_PRODUCT_LABELS, N_TIMING_LABELS, applyNSummary } from '@shared/utils/ci-enrollment';

type IntakeSeason = CiIntakeFields & { syntheticN: number | null; niFraction: number };

/**
 * The audit-grade part of a scored field season, shared by every field-plan option's dialog:
 * nitrogen applications (which set the season's N rate and inhibitor share), other fertilizer,
 * on-farm energy and the supporting records. Edits the season in place, like the dialogs' other
 * inputs, and emits `changed` so the dialog saves.
 */
@Component({
  selector: 'app-ci-intake-sections',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './field-plan.css',
  template: `
    @let s = season();
    <!-- Nitrogen -->
    <div>
      <div class="text-sm text-gray-700 dark:text-gray-300" [class.text-amber-700]="s.syntheticN === null">Commercial nitrogen applications</div>
      @if (s.nApplications.length === 0) {
        <div class="mt-1 flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
          <label class="flex items-center gap-2">
            <input type="checkbox" [disabled]="disabled()" [(ngModel)]="s.noNApplied" (ngModelChange)="save()" />
            No commercial N applied this year
          </label>
          @if (!disabled() && !s.noNApplied) {
            <button type="button" class="text-scoular-green-accessible dark:text-scoular-green hover:underline bg-transparent border-0 p-0" (click)="addApplication()">+ Add application</button>
          }
        </div>
      } @else {
        <div class="mt-1 space-y-2">
          @for (a of s.nApplications; track $index; let i = $index) {
            <div class="grid items-end gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3 sm:grid-cols-[1.3fr_0.8fr_1fr_1.3fr_auto]">
              <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">Product</span>
                <select class="ci-input" [disabled]="disabled()" [(ngModel)]="a.product" (ngModelChange)="save()">
                  @for (p of products; track p) { <option [value]="p">{{ productLabels[p] }}</option> }
                </select></label>
              <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">lbs N/ac</span>
                <input type="number" min="0" class="ci-input" [class.ci-missing]="!a.lbsN" [disabled]="disabled()" [(ngModel)]="a.lbsN" (ngModelChange)="save()" /></label>
              <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">Timing</span>
                <select class="ci-input" [disabled]="disabled()" [(ngModel)]="a.timing" (ngModelChange)="save()">
                  @for (t of timings; track t) { <option [value]="t">{{ timingLabels[t] }}</option> }
                </select></label>
              <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">Enhanced efficiency</span>
                <select class="ci-input" [disabled]="disabled()" [(ngModel)]="a.efficiency" (ngModelChange)="save()">
                  @for (e of efficiencies; track e) { <option [value]="e">{{ efficiencyLabels[e] }}</option> }
                </select></label>
              @if (!disabled()) {
                <button type="button" class="h-9 px-2 text-sm text-gray-500 hover:text-red-600 bg-transparent border-0" (click)="removeApplication(i)" aria-label="Remove N application">✕</button>
              }
            </div>
          }
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="text-gray-600 dark:text-gray-300">
              Total <span class="font-semibold">{{ s.syntheticN ?? 0 | number:'1.0-1' }} lbs N/ac</span>
              · {{ s.niFraction | percent:'1.0-0' }} with a nitrification inhibitor
            </span>
            @if (!disabled() && s.nApplications.length < 6) {
              <button type="button" class="text-scoular-green-accessible dark:text-scoular-green hover:underline bg-transparent border-0 p-0" (click)="addApplication()">+ Add another</button>
            }
          </div>
        </div>
      }
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Pounds of actual N, not product. Inhibitors: e.g. N-Serve, Instinct, Centuro. Only a nitrification inhibitor lowers the 45Z score; the others are recorded for the audit.</p>
    </div>

    <!-- Other fertilizer -->
    <div>
      <div class="text-sm text-gray-700 dark:text-gray-300">Other fertilizer <span class="text-gray-500">(blank = none applied)</span></div>
      <div class="mt-1 grid gap-3 sm:grid-cols-3">
        <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">Phosphate (lbs P₂O₅/ac)</span>
          <input type="number" min="0" class="ci-input" [disabled]="disabled()" [(ngModel)]="s.phosphateLbs" (ngModelChange)="save()" /></label>
        <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">Potash (lbs K₂O/ac)</span>
          <input type="number" min="0" class="ci-input" [disabled]="disabled()" [(ngModel)]="s.potashLbs" (ngModelChange)="save()" /></label>
        <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">Lime (tons/ac)</span>
          <input type="number" min="0" class="ci-input" [disabled]="disabled()" [(ngModel)]="s.limeTons" (ngModelChange)="save()" /></label>
      </div>
    </div>

    <!-- On-farm energy -->
    <div>
      <div class="text-sm text-gray-700 dark:text-gray-300">On-farm energy per acre <span class="text-gray-500">(optional; blank = not reported)</span></div>
      <div class="mt-1 grid gap-3 sm:grid-cols-5">
        @for (e of energyInputs; track e.key) {
          <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">{{ e.label }}</span>
            <input type="number" min="0" class="ci-input" [disabled]="disabled()" [(ngModel)]="s.energy[e.key]" (ngModelChange)="save()" /></label>
        }
      </div>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Fuel for field passes and grain drying, and irrigation power. Without it the calculator uses its default.</p>
    </div>

    <!-- Supporting records -->
    <div>
      <div class="text-sm text-gray-700 dark:text-gray-300">Supporting records <span class="text-gray-500">(what an auditor will ask to see)</span></div>
      @if (s.evidence.length) {
        <ul class="mt-1 divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">
          @for (ev of s.evidence; track ev.id; let i = $index) {
            <li class="flex items-center justify-between gap-2 px-3 py-2">
              <span><span class="text-gray-500 dark:text-gray-400">{{ evidenceLabels[ev.kind] }}:</span> <span class="text-gray-900 dark:text-white">{{ ev.reference }}</span></span>
              @if (!disabled()) {
                <button type="button" class="px-2 text-gray-500 hover:text-red-600 bg-transparent border-0" (click)="removeEvidence(i)" [attr.aria-label]="'Remove ' + ev.reference">✕</button>
              }
            </li>
          }
        </ul>
      } @else {
        <div class="mt-1 text-sm text-amber-700 dark:text-amber-400">None yet. Finalizing needs a yield record, and an N invoice or application record when N was applied.</div>
      }
      @if (!disabled()) {
        <div class="mt-2 grid items-end gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
          <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">Record</span>
            <select class="ci-input" [(ngModel)]="newKind">
              @for (k of evidenceKinds; track k) { <option [value]="k">{{ evidenceLabels[k] }}</option> }
            </select></label>
          <label class="block text-sm"><span class="text-gray-700 dark:text-gray-300">File name or document #</span>
            <input class="ci-input" [(ngModel)]="newReference" (keydown.enter)="addEvidence()" placeholder="e.g. Co-op invoice 48812" /></label>
          <button type="button" class="h-9 rounded-md border border-gray-300 dark:border-gray-600 px-3 text-sm bg-transparent text-gray-700 dark:text-gray-200 disabled:opacity-50"
                  [disabled]="!newReference.trim()" (click)="addEvidence()">Add</button>
        </div>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Prototype: records are listed by reference only; nothing is uploaded.</p>
      }
    </div>
  `,
  host: { class: 'block space-y-6' },
})
export class CiIntakeSectionsComponent {
  readonly season = input.required<IntakeSeason>();
  readonly disabled = input(false);
  readonly changed = output<void>();

  readonly productLabels = N_PRODUCT_LABELS;
  readonly timingLabels = N_TIMING_LABELS;
  readonly efficiencyLabels = N_EFFICIENCY_LABELS;
  readonly evidenceLabels = EVIDENCE_LABELS;
  readonly products = Object.keys(N_PRODUCT_LABELS) as NProduct[];
  readonly timings = Object.keys(N_TIMING_LABELS) as NTiming[];
  readonly efficiencies = Object.keys(N_EFFICIENCY_LABELS) as NEfficiency[];
  readonly evidenceKinds = Object.keys(EVIDENCE_LABELS) as EvidenceKind[];
  readonly energyInputs: { key: keyof OnFarmEnergy; label: string }[] = [
    { key: 'dieselGal', label: 'Diesel (gal)' },
    { key: 'gasolineGal', label: 'Gasoline (gal)' },
    { key: 'lpGal', label: 'Propane (gal)' },
    { key: 'naturalGasTherms', label: 'Natural gas (therms)' },
    { key: 'electricityKwh', label: 'Electricity (kWh)' },
  ];

  newKind: EvidenceKind = 'NInvoice';
  newReference = '';

  /** Re-derives the N rate and inhibitor share from the applications, then lets the dialog save. */
  save(): void {
    applyNSummary(this.season());
    this.changed.emit();
  }

  addApplication(): void {
    const s = this.season();
    const last = s.nApplications.at(-1);
    const app: NApplication = { product: last?.product ?? 'Anhydrous', lbsN: null, timing: last ? 'Sidedress' : 'Preplant', efficiency: 'None' };
    s.nApplications.push(app);
    s.noNApplied = false;
    this.save();
  }

  removeApplication(index: number): void {
    this.season().nApplications.splice(index, 1);
    this.save();
  }

  addEvidence(): void {
    const reference = this.newReference.trim();
    if (!reference) return;
    this.season().evidence.push({ id: crypto.randomUUID(), kind: this.newKind, reference, addedBy: 'you', addedAt: new Date().toISOString() });
    this.newReference = '';
    this.save();
  }

  removeEvidence(index: number): void {
    this.season().evidence.splice(index, 1);
    this.save();
  }
}
