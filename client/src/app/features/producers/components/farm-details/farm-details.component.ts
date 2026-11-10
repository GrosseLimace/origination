import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { DecimalPipe, CurrencyPipe } from '@angular/common';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';
import { AppStateService } from '@core/services/app-state.service';
import { GrainOnFarmItem } from '@models';
import { buildCropGroupLookup } from '@shared/utils/crop-group-match';
import { formatLastBid, grainOnFarmTitle, indexCommoditiesByCode } from '@shared/utils/grain-on-farm';
import { readCollapsed, writeCollapsed } from '../../utils/remembered-collapse';

/** Where an explicit close of the Grain on Farm table is remembered. */
export const GRAIN_ON_FARM_COLLAPSED_KEY = 'origination.profile.grainOnFarm.collapsed';

/**
 * Farm Details in the profile's details row: the producer's acres, the commodities they deal in, and the bushels on
 * their farm, which open the Grain on Farm table. Its element takes no space, so the column and the open table are
 * grid items of the details row. The table is marked details-span and placed last, and the profile makes room for it
 * beside the Contact column. The values are entered in the Edit Producer dialog; this only shows them.
 */
@Component({
  selector: 'app-farm-details',
  standalone: true,
  imports: [DecimalPipe, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  templateUrl: './farm-details.component.html',
})
export class FarmDetailsComponent {
  readonly customer = inject(SelectedCustomerContext).customer;
  /** The commodity codes the producer deals in: their tickets' and those on their profile. */
  readonly commodityCodes = inject(SelectedProducerProduction).commodityCodes;
  private readonly commodities = inject(AppStateService).commodities;

  readonly formatLastBid = formatLastBid;

  /** Grain-on-farm rows with a positive total or sold, a target or last bid, or a grade entered, grouped by bin site
   *  in the sites' order (rows not tied to a site last), total descending within a site. */
  readonly rows = computed(() => {
    const customer = this.customer();
    const siteOrder = new Map((customer?.binSites ?? []).map((b, i) => [b.siteKey, i]));
    const orderOf = (key: string | null | undefined) => (key ? siteOrder.get(key) : undefined) ?? Number.MAX_SAFE_INTEGER;
    return (customer?.grainOnFarm ?? [])
      .filter(g => (g.bushelsOnHand ?? 0) > 0 || (g.bushelsSold ?? 0) > 0 || g.targetBushels != null || g.lastBid != null || !!(g.grade ?? '').trim())
      .sort((a, b) => orderOf(a.binSiteKey) - orderOf(b.binSiteKey) || (b.bushelsOnHand ?? 0) - (a.bushelsOnHand ?? 0));
  });

  /** The rows grouped by bin site for the table: one group per site in site order, then the rows not tied to a site.
   *  The label is the site name; the unlinked group is labelled only when sites are present too, so a producer with
   *  no linked grain shows a plain table. */
  readonly groups = computed(() => {
    const groups: { key: string | null; label: string; rows: GrainOnFarmItem[] }[] = [];
    for (const g of this.rows()) {
      const key = g.binSiteKey ?? null;
      let group = groups.find(x => x.key === key);
      if (!group) {
        group = { key, label: key ? (g.binSiteName?.trim() || 'Bin site') : '', rows: [] };
        groups.push(group);
      }
      group.rows.push(g);
    }
    const unlinked = groups.find(x => x.key === null);
    if (unlinked && groups.length > 1) unlinked.label = 'Not tied to a bin site';
    return groups;
  });

  /** With grain at more than one bin site, each site is a closed line ("North Bins · 2 crops · 35,000 bu") until the
   *  user opens it (user 2026-10-12: a producer with many bins showed too much at once). With one site, or none, the
   *  table shows open. */
  readonly groupsCollapsible = computed(() => this.groups().length > 1);
  /** Open site groups, by index into `groups` (site order). All closed again when the producer changes. */
  readonly openGroups = linkedSignal<number | null, ReadonlySet<number>>({
    source: () => this.customer()?.id ?? null,
    computation: () => new Set(),
  });

  isGroupOpen(index: number): boolean {
    return !this.groupsCollapsible() || this.openGroups().has(index);
  }

  toggleGroup(index: number): void {
    this.openGroups.update(open => {
      const next = new Set(open);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  /** The crop column headings show once there is a row to label. */
  readonly anyGroupOpen = computed(() => !this.groupsCollapsible() || this.openGroups().size > 0);

  /** A closed site's line: "2 crops · 35,000 bu". */
  groupSummary(rows: readonly GrainOnFarmItem[]): string {
    const bushels = rows.reduce((sum, g) => sum + (g.bushelsOnHand ?? 0), 0);
    return `${rows.length} crop${rows.length === 1 ? '' : 's'} · ${bushels.toLocaleString('en-US')} bu`;
  }

  /** Total bushels on the farm: every row's on-hand, at every site. */
  readonly total = computed(() => (this.customer()?.grainOnFarm ?? []).reduce((sum, g) => sum + (g.bushelsOnHand ?? 0), 0));

  /** Whether the table is expanded. Open by default and left however the user set it, across producers and reloads,
   *  like the Activity Summary (user 2026-10-12); only an explicit close is remembered. */
  readonly expanded = signal(!readCollapsed(GRAIN_ON_FARM_COLLAPSED_KEY));
  /** The table is on screen: expanded, and something to show. */
  readonly tableOpen = computed(() => this.expanded() && this.rows().length > 0);

  /** Expands or collapses the table, when there's something to show. */
  toggle(): void {
    if (this.rows().length === 0) return;
    this.expanded.update(open => !open);
    writeCollapsed(GRAIN_ON_FARM_COLLAPSED_KEY, !this.expanded());
  }

  // A row holds a commodity code, or a legacy crop-group name; hovering the Crop cell shows the commodity's name.
  private readonly cropLookup = computed(() => buildCropGroupLookup(this.commodities()));
  private readonly byCode = computed(() => indexCommoditiesByCode(this.commodities()));

  /** Hover text for a crop: the commodity's name, or the legacy-row note. */
  cropTitle(value: string): string {
    return grainOnFarmTitle(value, this.byCode(), this.cropLookup());
  }
}
