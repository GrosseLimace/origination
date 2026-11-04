import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TDiscOptions, TDiscPass, TDiscResult, TDiscWindowKey } from '@models';
import { DESIGNATION_LABELS, operationsFor } from '../fd-cic-tdisc';

interface SearchResult { kind: 'operation' | 'implement'; name: string; implements: string[] }

/** Results shown per group; typing narrows them. */
const MAX_RESULTS = 50;

/**
 * The review's USDA T-DISC worksheet: the field's passes from last harvest through this one, each a tillage
 * window and a T-DISC implement, with the index of each window and the rating (the highest index). A pass is
 * picked by USDA's implement name or by an everyday operation from USDA's lookup, which adds one pass per
 * implement it maps to. Read-only once the field is confirmed, when it shows the server's worksheet.
 */
@Component({
  selector: 'app-review-tdisc',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../field-plan.css',
  template: `
@if (!options() && !readOnly()) {
  <p class="mt-3 text-sm text-gray-600 dark:text-gray-300" aria-live="polite">
    {{ optionsError() || 'Loading USDA T-DISC…' }}
    @if (optionsError()) {
      <button type="button" class="ml-1 bg-transparent border-0 p-0 underline text-inherit" (click)="retry.emit()">Try again</button>
    }
  </p>
} @else {
  @if (!readOnly()) {
    <div class="mt-3 flex flex-wrap items-start gap-2">
      <label class="block text-sm">
        <span class="text-gray-700 dark:text-gray-300">Tillage window</span>
        <select class="ci-input ci-compact mt-1 block" [ngModel]="window()" (ngModelChange)="window.set($event); picked.set('')">
          @for (w of options()!.windows; track w.key) { <option [value]="w.key">{{ w.label }}</option> }
        </select>
      </label>
      <div class="relative min-w-72 flex-1 text-sm">
        <label for="tdisc-search" class="text-gray-700 dark:text-gray-300">Add a pass: operation or T-DISC implement</label>
        <input id="tdisc-search" class="ci-input ci-compact mt-1 block w-full" autocomplete="off" role="combobox" aria-autocomplete="list"
               aria-controls="tdisc-results" [attr.aria-expanded]="open()" [attr.aria-activedescendant]="open() && results().length ? 'tdisc-opt-' + active() : null"
               [disabled]="full()" [ngModel]="picked()" (ngModelChange)="search($event)" (focus)="open.set(true)" (blur)="open.set(false)"
               (keydown)="onKey($event)" placeholder="Type to search, e.g. chisel" aria-describedby="tdisc-add-note" />
        @if (open()) {
          <div id="tdisc-results" role="listbox" aria-label="Operations and T-DISC implements" class="scoular-dropdown !static mt-1 max-h-72 w-full overflow-y-auto">
            @for (r of results(); track r.kind + r.name; let i = $index) {
              @if (i === 0 || results()[i - 1].kind !== r.kind) {
                @if (i > 0) { <div class="scoular-dropdown-divider" role="presentation"></div> }
                <div class="scoular-dropdown-header" role="presentation">{{ r.kind === 'operation' ? 'USDA operations' : 'T-DISC implements' }}</div>
              }
              <div [id]="'tdisc-opt-' + i" role="option" [attr.aria-selected]="i === active()" class="scoular-dropdown-item cursor-pointer !flex-col !items-start !gap-0"
                   [class.active]="i === active()" (mousedown)="$event.preventDefault(); choose(r)" (mouseenter)="active.set(i)">
                <span>{{ r.name }}</span>
                @if (r.kind === 'operation') { <span class="text-xs text-gray-500 dark:text-gray-400">{{ r.implements.join(' + ') }}</span> }
              </div>
            } @empty {
              <div class="scoular-dropdown-header" role="presentation">Nothing in {{ windowLabel(window()).toLowerCase() }} matches "{{ picked() }}".</div>
            }
          </div>
        }
      </div>
    </div>
    <p id="tdisc-add-note" class="mt-1 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
      {{ addNote() || (full() ? 'T-DISC takes at most ' + options()!.maxPasses + ' passes.' : 'An operation adds a pass for each T-DISC implement it maps to.') }}
    </p>
  }

  @if (shownPasses().length) {
    <table class="mt-3 w-full text-sm">
      <thead>
        <tr class="text-left text-xs text-gray-500 dark:text-gray-400">
          <th class="py-1 pr-2 font-medium">Window</th>
          <th class="py-1 pr-2 font-medium">T-DISC implement</th>
          <th class="py-1 pr-2 text-right font-medium">Mixing efficiency</th>
          <th class="py-1 pr-2 text-right font-medium">Depth (cm)</th>
          @if (readOnly()) { <th class="py-1 pr-2 text-right font-medium">Tillage intensity</th> }
          @else { <th class="py-1"><span class="sr-only">Remove</span></th> }
        </tr>
      </thead>
      <tbody>
        @for (p of shownPasses(); track $index) {
          <tr class="border-t border-gray-100 dark:border-gray-700">
            <td class="py-1 pr-2 text-gray-700 dark:text-gray-300">{{ windowLabel(p.window) }}</td>
            <td class="py-1 pr-2 text-gray-900 dark:text-white">{{ p.implement }}</td>
            <td class="py-1 pr-2 text-right tabular-nums">{{ p.mixingEfficiency | number:'1.2-2' }}</td>
            <td class="py-1 pr-2 text-right tabular-nums">{{ p.depthCm }}</td>
            @if (readOnly()) { <td class="py-1 pr-2 text-right tabular-nums">{{ p.tillageIntensity | number:'1.3-3' }}</td> }
            @else {
              <td class="py-1 text-right">
                <button type="button" class="border-0 bg-transparent p-0 text-xs text-red-700 hover:underline dark:text-red-400"
                        [attr.aria-label]="'Remove ' + p.implement + ' from ' + windowLabel(p.window)" (click)="remove($index)">Remove</button>
              </td>
            }
          </tr>
        }
      </tbody>
    </table>
    @if (readOnly()) { <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Sorted as T-DISC rates them: by depth, then mixing efficiency.</p> }
  } @else if (!readOnly()) {
    <p class="mt-3 text-sm text-gray-600 dark:text-gray-300">No passes yet. Add every pass, including planting and harvest.</p>
  }

  @if (result(); as r) {
    <div class="mt-3 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
      <table class="text-sm">
        <caption class="sr-only">T-DISC index by tillage window</caption>
        <tbody>
          @for (w of r.windows; track w.key) {
            <tr>
              <th scope="row" class="py-0.5 pr-2 text-left font-normal text-gray-700 dark:text-gray-300">{{ w.label }}</th>
              <td class="py-0.5 pr-2 text-right tabular-nums">{{ w.index === null ? '—' : (w.index | number:'1.3-3') }}</td>
              <td class="py-0.5 text-gray-600 dark:text-gray-400">{{ w.designation ? designationLabel(w.designation) : '' }}</td>
            </tr>
          }
        </tbody>
      </table>
      <p class="mt-1 border-t border-gray-100 pt-1 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white" aria-live="polite">
        T-DISC rating {{ r.rating | number:'1.3-3' }} · {{ designationLabel(r.designation) }}
      </p>
      <p class="text-xs text-gray-500 dark:text-gray-400">The rating is the highest window index. No till is 0.075 or less; reduced till is 0.252 or less.</p>
    </div>
  }
}
`,
})
export class ReviewTDiscComponent {
  readonly options = input.required<TDiscOptions | null>();
  readonly optionsError = input('');
  /** Load the options again after an error. */
  readonly retry = output<void>();
  readonly passes = input.required<readonly TDiscPass[]>();
  /** The live worksheet, or the server's once confirmed. */
  readonly result = input.required<TDiscResult | null>();
  readonly readOnly = input(false);
  readonly passesChange = output<TDiscPass[]>();

  readonly window = signal<TDiscWindowKey>('Field_Preparation');
  readonly picked = signal('');
  readonly addNote = signal('');

  readonly full = computed(() => this.passes().length >= (this.options()?.maxPasses ?? 20));
  readonly operationChoices = computed(() => { const o = this.options(); return o ? operationsFor(o, this.window()) : []; });
  readonly implementChoices = computed(() => this.options()?.windows.find(w => w.key === this.window())?.implements ?? []);

  /** Entered passes with their implement's numbers; once confirmed, the server's sorted worksheet. */
  readonly shownPasses = computed(() => {
    const r = this.result();
    if (this.readOnly() && r) return r.passes;
    const byName = new Map((this.options()?.implements ?? []).map(i => [i.name, i]));
    return this.passes().map(p => ({ ...p, mixingEfficiency: byName.get(p.implement)?.mixingEfficiency ?? 0, depthCm: byName.get(p.implement)?.depthCm ?? 0, tillageIntensity: 0 }));
  });

  windowLabel(key: TDiscWindowKey): string {
    return (this.options()?.windows ?? this.result()?.windows ?? []).find(w => w.key === key)?.label ?? key;
  }

  designationLabel(d: TDiscResult['designation']): string {
    return DESIGNATION_LABELS[d];
  }

  // ── The type-ahead (design system dropdown: scoular-dropdown / -item / -header) ──
  readonly open = signal(false);
  readonly active = signal(0);

  /** What matches the search in this window: USDA's operations first, then the T-DISC implements. */
  readonly results = computed((): SearchResult[] => {
    const q = this.picked().trim().toLowerCase();
    const hit = (name: string) => !q || name.toLowerCase().includes(q);
    return [
      ...this.operationChoices().filter(o => hit(o.name)).slice(0, MAX_RESULTS)
        .map(o => ({ kind: 'operation' as const, name: o.name, implements: o.implements })),
      ...this.implementChoices().filter(hit).slice(0, MAX_RESULTS)
        .map(i => ({ kind: 'implement' as const, name: i, implements: [i] })),
    ];
  });

  search(value: string): void {
    this.picked.set(value);
    this.active.set(0);
    this.open.set(true);
  }

  onKey(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.open()) { this.open.set(true); return; }
      if (!n) return;
      this.active.update(i => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      queueMicrotask(() => document.getElementById(`tdisc-opt-${this.active()}`)?.scrollIntoView?.({ block: 'nearest' }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = this.results()[this.active()];
      if (this.open() && r) this.choose(r);
    } else if (e.key === 'Escape' && this.open()) {
      e.stopPropagation(); // close the list, not the dialog
      this.open.set(false);
    }
  }

  /** Adds the chosen implement, or one pass per implement of the chosen operation. */
  choose(r: SearchResult): void {
    const options = this.options();
    if (!options || this.full()) return;
    const room = options.maxPasses - this.passes().length;
    if (r.implements.length > room) {
      this.addNote.set(`That adds ${r.implements.length} passes; there's room for ${room}.`);
      return;
    }
    const window = this.window();
    this.passesChange.emit([...this.passes(), ...r.implements.map(i => ({ window, implement: i }))]);
    this.picked.set('');
    this.active.set(0);
    this.open.set(false);
    this.addNote.set(`Added ${r.implements.join(' + ')} to ${this.windowLabel(window).toLowerCase()}.`);
  }

  remove(index: number): void {
    this.passesChange.emit(this.passes().filter((_, i) => i !== index));
  }
}
