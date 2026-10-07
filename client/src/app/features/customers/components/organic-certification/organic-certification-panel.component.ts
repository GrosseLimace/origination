import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CustomerOrganicCertification, OrganicCertificationScope } from '@models';
import { commodityChipClass } from '@shared/utils/commodity-color';

/**
 * The body of the organic badge's detail panel.
 *
 * Presentational only — the parent fetches, because the badge itself carries a status-change dot
 * and so needs the data before this panel is ever opened.
 *
 * Renders three states, all of which are normal:
 *   no NOP id              — the badge may be showing on the industry code alone, which is fine
 *   NOP id, nothing behind — show the id and warn (the organics desk asked for this explicitly)
 *   a certification        — status per scope, with crops grouped under each
 *
 * Everything shown is computed server-side. No date arithmetic and no string splitting happen
 * here: the compliance window, the certified flags and the crop lists all arrive ready to render,
 * so the browser's timezone cannot shift a calendar date across a boundary and a certifier's
 * punctuation cannot be parsed two different ways in two different places.
 */
@Component({
  selector: 'app-organic-certification-panel',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  templateUrl: './organic-certification-panel.component.html'
})
export class OrganicCertificationPanelComponent {
  /** Null while loading, or when the fetch failed — the panel degrades to the NOP id alone
   *  rather than showing a spinner on the producer's name line. */
  public certification = input<CustomerOrganicCertification | null>(null);

  /** The producer's NOP id from the customer record. Shown even when no certification has
   *  arrived, so a trader always sees the id the business works from. */
  public nopId = input<string | null | undefined>(null);

  readonly data = computed(() => this.certification());

  readonly cert = computed(() => this.data()?.certification ?? null);

  /** A NOP id on file with no certification behind it. Warned about rather than left blank. */
  readonly noCertificateOnFile = computed(() => this.data()?.noCertificateOnFile === true);

  /** Scopes that actually certify something, ordered with certified ones first so a trader sees
   *  what they CAN trade before what they cannot. */
  readonly scopes = computed<OrganicCertificationScope[]>(() => {
    const scopes = this.cert()?.scopes ?? [];
    return [...scopes].sort((a, b) => {
      if (a.isCertified !== b.isCertified) return a.isCertified ? -1 : 1;
      return a.scope.localeCompare(b.scope);
    });
  });

  /** True when the certifier's record has gone stale past the desk's window, or carries no date
   *  at all. Server-computed; this is a straight read. */
  readonly recordStale = computed(() => this.cert()?.outsideComplianceWindow === true);

  /** "18 months ago", "unknown" — the human form of monthsSinceSourceUpdate. */
  readonly updatedAgeLabel = computed(() => {
    const months = this.cert()?.monthsSinceSourceUpdate;
    if (months === null || months === undefined) return 'date unknown';
    if (months === 0) return 'this month';
    if (months === 1) return '1 month ago';
    return `${months} months ago`;
  });

  /** Whether the next scheduled annual update has already passed. Shown alongside the compliance
   *  signal rather than folded into it: the two measure different things and routinely disagree,
   *  so collapsing them would hide a real distinction from the desk.
   *
   *  Server-computed since 2026-10-07, when this became a badge signal too. It used to parse the
   *  date here, which contradicted this component's own rule that no date arithmetic happens in
   *  the browser — and would have let the badge and the panel disagree about the same date. */
  readonly anniversaryPastDue = computed(() => this.cert()?.anniversaryPastDue === true);

  /** Chip colours reuse the app-wide commodity palette, keyed on the crop name. Unmapped crops
   *  fall back to the neutral chip rather than vanishing — a certifier's wording is not a reason
   *  to hide a crop a producer is certified for. */
  chipClass(crop: string): string {
    return commodityChipClass(crop);
  }

  /** Tracking key for the crop chips. Index, not value: certifier free text can legitimately
   *  repeat across scopes and a duplicate key crashes `@for`. */
  trackIndex(index: number): number {
    return index;
  }
}
