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
  templateUrl: './review-tdisc.component.html',
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
