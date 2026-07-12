import { Component, ChangeDetectionStrategy, ElementRef, inject, input, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CustomerFieldTag, parseCdlSnapshot, topCrop } from '@models';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { FIELD_TAG_METHOD_STYLE } from '../../field-tag-style';

/**
 * FieldTagListComponent — the ~1/3-width list pane in the Field Tagging POC's "Fields (N)" tab.
 * See docs/maps/field-tagging/04-frontend-list-and-hover-sync.md → "FieldTagListComponent".
 *
 * Purely presentational: all persistence and hover-state ownership live in the parent
 * (`CustomerFieldsComponent`). Hover flows both ways through the parent's single `hoveredTagId`
 * signal (see the doc's "no feedback loop" reasoning) — this component only emits raw pointer
 * events and renders whatever `hoveredTagId` it's given, it never decides the "true" hover state.
 */
@Component({
  selector: 'app-field-tag-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, BadgeComponent],
  templateUrl: './field-tag-list.component.html',
})
export class FieldTagListComponent {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly tags = input<CustomerFieldTag[]>([]);
  readonly hoveredTagId = input<number | null>(null);

  readonly rowHover = output<number | null>();
  readonly rowClick = output<number>();
  readonly delete = output<number>();

  readonly methodStyle = FIELD_TAG_METHOD_STYLE;

  /** Which rows have their full CDL breakdown expanded (chevron toggle). */
  private readonly expandedIds = signal<Set<number>>(new Set());

  constructor() {
    // When hoveredTagId changes (from either origin — see class doc), scroll the matching row into
    // view only if it isn't already visible. This is inherently a no-op for list-originated hovers
    // (the cursor is already on that row), so no origin flag is needed — see 04-frontend-list-
    // and-hover-sync.md's "Row behaviors" section.
    effect(() => {
      const id = this.hoveredTagId();
      if (id == null) return;
      const container = this.host.nativeElement;
      const row = container.querySelector<HTMLElement>(`[data-tag-row="${id}"]`);
      if (!row) return;
      const rowRect = row.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const isVisible = rowRect.top >= containerRect.top && rowRect.bottom <= containerRect.bottom;
      if (!isVisible) row.scrollIntoView({ block: 'nearest' });
    });
  }

  isExpanded(tagId: number): boolean {
    return this.expandedIds().has(tagId);
  }

  toggleExpand(tagId: number): void {
    const next = new Set(this.expandedIds());
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    this.expandedIds.set(next);
  }

  onRowClick(tagId: number): void {
    this.rowClick.emit(tagId);
  }

  onDelete(event: Event, tagId: number): void {
    event.stopPropagation();
    this.delete.emit(tagId);
  }

  onToggleExpand(event: Event, tagId: number): void {
    event.stopPropagation();
    this.toggleExpand(tagId);
  }

  /** Auto-generated label: "{Source} field · {acres} ac · captured {date}" (acres segment omitted
   *  when calcAcres is null). Not user-editable — see the doc's "Deferred: Label nickname". */
  labelFor(tag: CustomerFieldTag): string {
    const source = this.methodStyle[tag.selectionMethod].label;
    const parts = [`${source} field`];
    if (tag.calcAcres != null) parts.push(`${tag.calcAcres.toFixed(1)} ac`);
    parts.push(`captured ${this.formatDate(tag.createdAt)}`);
    return parts.join(' · ');
  }

  /** CDL year + top crop, e.g. "2024 · Corn". Null when there's no CDL snapshot to summarize. */
  cdlSummary(tag: CustomerFieldTag): string | null {
    const crop = topCrop(tag);
    if (!tag.cdlYear || !crop) return null;
    return `${tag.cdlYear} · ${crop.crop}`;
  }

  breakdown(tag: CustomerFieldTag) {
    return parseCdlSnapshot(tag).sort((a, b) => b.intersectionAcres - a.intersectionAcres);
  }

  hasCdlData(tag: CustomerFieldTag): boolean {
    return !!tag.cdlSnapshotJson && parseCdlSnapshot(tag).length > 0;
  }

  private formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    // en-CA renders YYYY-MM-DD, matching the doc's label example ("captured 2026-07-11"),
    // in the viewer's local timezone (Date's toLocaleDateString always renders local time).
    return date.toLocaleDateString('en-CA');
  }
}
