import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { googleMapsCoordinatesUrl } from '@shared/utils/address';
import { binSiteHasCoordinates } from '@shared/utils/coordinates';
import { readCollapsed, writeCollapsed } from '../../utils/remembered-collapse';

/** Where an explicit close of the "Bin Sites (N)" table is remembered. */
export const BIN_SITES_COLLAPSED_KEY = 'origination.profile.binSites.collapsed';

/**
 * The producer's bin sites, at the bottom of the profile's Contact and Locations column. One site is a line of its own:
 * name, capacity and a map pin (user 2026-10-12: no "Bin Sites (1)" toggle for one). Two or more fold behind
 * "Bin Sites (N)", which opens a compact table: Name | Cap | pin. Its element takes no space, so its line is one of the
 * column's own.
 */
@Component({
  selector: 'app-bin-sites',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  templateUrl: './bin-sites.component.html',
})
export class BinSitesComponent {
  private readonly customer = inject(SelectedCustomerContext).customer;
  private readonly usageTracking = inject(UsageTrackingService);

  /** The sites in saved order, every cell already formatted ("50,000", or "—" when empty). The coordinates aren't a
   *  column: the pin opens them in Google Maps at full precision, or there's no pin when the site has none. */
  readonly rows = computed(() => {
    const bushels = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'));
    return (this.customer()?.binSites ?? []).map(site => ({
      name: site.name?.trim() || 'Bin site',
      capacity: bushels(site.capacity),
      url: binSiteHasCoordinates(site) ? googleMapsCoordinatesUrl(site.latitude, site.longitude) : null,
    }));
  });

  /** A producer with exactly one site: that site, on its own line. Null with none or several. */
  readonly singleSite = computed(() => {
    const rows = this.rows();
    return rows.length === 1 ? rows[0] : null;
  });

  /** Two or more sites: the table, open by default and left however the user set it, across producers and reloads. */
  readonly expanded = signal(!readCollapsed(BIN_SITES_COLLAPSED_KEY));

  toggle(): void {
    this.expanded.update(open => !open);
    writeCollapsed(BIN_SITES_COLLAPSED_KEY, !this.expanded());
  }

  trackMapClick(): void {
    const id = this.customer()?.id;
    if (id != null) this.usageTracking.trackBinSiteMapClick(id.toString());
  }
}
