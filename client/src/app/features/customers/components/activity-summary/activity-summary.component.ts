import { Component, input, effect, inject, signal, computed, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, HarvestWindow } from '@models';
import { AppStateService } from '@core/services/app-state.service';
import { getContractDeliveryStats } from '@shared/utils/contract-delivery';
import { buildLbsPerBushelMap, quantityInBushels, sumInBushels } from '@shared/utils/production-coverage';
import { parseServerTime } from '@shared/utils/server-time';

@Component({
  selector: 'app-activity-summary',
  standalone: true,
  // Inputs and signals only, except summaryText, which the effect below writes and then marks the
  // view for. An input change already marks an OnPush view; the explicit call removes the dependency.
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  host: { class: 'block' },
  templateUrl: './activity-summary.component.html'
})
export class ActivitySummaryComponent {
  private readonly appState = inject(AppStateService);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Commodity code → lbs per bushel. Derived from the signal, so any replacement of the conversion
   *  list rebuilds it (it used to be cached until the list's length changed). */
  private readonly _conversionMap = computed(() =>
    new Map(this.appState.commodityConversions().map(c => [c.commodityCode.trim().toUpperCase(), c.lbsPerUnit])));

  public customer = input.required<Customer>();
  public contracts = input<Contract[]>([]);
  public tickets = input<Ticket[]>([]);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public notes = input<Note[]>([]);
  public storedGrain = input<StoredGrain[]>([]);
  /** Transitively-linked producers, resolved by home.getLinkedGroup() (BFS over forward + reverse
   *  edges across both the TU-scoped customers signal and the cross-TU cache). */
  public linkedCustomers = input<Customer[]>([]);
  /** Closed historical contracts — needed for the harvest-pace year-over-year comparison.
   *  customer-profile already maintains this signal and shares it with the contract-pacing
   *  card; we receive it here as input to avoid a duplicate API fetch. */
  public historicalContracts = input<Contract[]>([]);

  summaryText = '';

  /** localStorage key for the open/closed preference. Persisted rather than held in the component
   *  so the choice survives selecting a different producer — this component is torn down whenever
   *  the profile unmounts between selections — and survives a reload, which is what someone who
   *  collapsed it expects. */
  private static readonly COLLAPSED_KEY = 'origination.activitySummary.collapsed';

  /** Open by default; only an explicit collapse is remembered. */
  readonly expanded = signal(!ActivitySummaryComponent.readCollapsed());

  toggle(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    try {
      localStorage.setItem(ActivitySummaryComponent.COLLAPSED_KEY, next ? 'false' : 'true');
    } catch {
      // Private browsing / storage disabled — the toggle still works for this session.
    }
  }

  private static readCollapsed(): boolean {
    try {
      return localStorage.getItem(ActivitySummaryComponent.COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  }

  constructor() {
    effect(() => {
      // Read all inputs to register reactive dependencies
      const _customer = this.customer();
      const _contracts = this.contracts();
      const _tickets = this.tickets();
      const _plantingIntentions = this.plantingIntentions();
      const _notes = this.notes();
      const _storedGrain = this.storedGrain();
      const _linked = this.linkedCustomers();
      const _historical = this.historicalContracts();
      // commodityConversions feeds the spot-load / unapplied ticket bushel sums; tracking it ensures the summary
      // recalculates once GNP024 lookups become available after an initial empty load.
      const _conv = this.appState.commodityConversions();
      // Harvest windows drive _generateHarvestPaceSummary's year-over-year comparison.
      const _hw = this.appState.harvestWindows();
      this.summaryText = this._generateSummaryParagraph();
      this.cdr.markForCheck();
    });
  }

  private _generateSummaryParagraph(): string {
    try {
      const paragraphs: string[] = [];

      paragraphs.push(this._generateCustomerIntro());
      paragraphs.push(this._generateContractSummary());
      paragraphs.push(this._generateHarvestPaceSummary());
      paragraphs.push(this._generatePlantingOverview());
      paragraphs.push(this._generateStorageSummary());
      paragraphs.push(this._generateDeliverySummary());
      paragraphs.push(this._generateEngagementSummary());
      paragraphs.push(this._generateActionItems());

      const filtered = paragraphs.filter(s => s && s.length > 0);

      if (filtered.length === 0) {
        return 'No activity data available for this customer.';
      }

      return filtered.join(' ');
    } catch (error) {
      return 'Unable to generate activity summary at this time.';
    }
  }

  private _generateCustomerIntro(): string {
    if (!this.customer()) return '';

    const customerName = this.customer().name || 'This customer';
    const acres = this.customer().totalAcres || 0;
    const farm = this.customer().farm || '';
    const primaryContact = (this.customer().primaryContact || '').trim();
    const commodities = this.customer().commodities || [];
    const linkedGroup = this._getLinkedGroup();

    // Prefer the primary-contact name as the subject of the narrative ("John operates 5,000
    // acres...") since that's who the merchandiser actually talks to. Fall back to the
    // producer/business name when no primary contact is on file.
    const subject = primaryContact || customerName;

    const commStr = commodities.length === 1
      ? commodities[0]
      : commodities.length > 1
        ? commodities.slice(0, -1).join(', ') + ' and ' + commodities[commodities.length - 1]
        : '';

    const parts: string[] = [];

    // Opening sentence — who they are
    let opening = subject;
    if (acres > 0 && farm && farm !== 'Unknown Farm') {
      opening += ` operates ${this._formatQuantity(acres, 'acres')} at ${farm}`;
    } else if (acres > 0) {
      opening += ` operates ${this._formatQuantity(acres, 'acres')}`;
    } else if (farm && farm !== 'Unknown Farm') {
      opening += ` farms at ${farm}`;
    }
    if (commStr) opening += `, primarily growing ${commStr}`;
    parts.push(opening + '.');

    // Linked producers
    if (linkedGroup.length === 1) {
      parts.push(`Linked with ${linkedGroup[0].name}${linkedGroup[0].scoularId ? ' (' + linkedGroup[0].scoularId + ')' : ''}.`);
    } else if (linkedGroup.length >= 2) {
      const names = linkedGroup.map(p => p.name).join(' and ');
      parts.push(`Linked with ${names}.`);
    }

    return parts.join(' ');
  }

  private _getLinkedGroup(): Customer[] {
    // Authoritative resolution lives on home.getLinkedGroup() — it walks the full
    // transitive closure (forward + reverse) over customers + cross-TU cache with
    // a visited guard. We accept the result via input so the intro narrative
    // matches the linked-producer dropdown count exactly.
    return this.linkedCustomers();
  }

  private _generateContractSummary(): string {
    // Same scope contracts-table shows — every open contract (closedDate is null), regardless
    // of status. Active / Pending / Overdue are all on screen; the narrative should describe
    // the same list.
    const openContracts = (this.contracts() || []).filter(c => c && !c.closedDate);
    if (openContracts.length === 0) return '';

    const pendingContracts = openContracts.filter(c => c.status === 'Pending');
    // Overdue + unsigned counts are surfaced in _generateActionItems (with richer
    // bushel-context wording), so we don't recompute or report them here.

    const parts: string[] = [];
    // Bushels, not a raw quantity sum — this sentence says "bushels" out loud, and a commodity group
    // carries products priced by weight (soybean meal in short tons, popcorn by the pound).
    const lbsPerBushelByCode = buildLbsPerBushelMap(this.appState.commodityConversions());
    const totalVolume = sumInBushels(openContracts, lbsPerBushelByCode).contracted;
    // Contract totalValue from CTRM doesn't reflect discounts/adjustments — intentionally
    // omitted to avoid showing the producer a misleading "contracts worth $X" number.

    // Sum Remaining via the shared delivery util — same numbers + same sub-0.1%
    // completion rule the contracts table shows.
    // The unshipped balance is in the contract's own unit too, so it needs the same conversion
    // before being reported as bushels.
    let totalRemaining = 0;
    for (const c of openContracts) {
      const stats = getContractDeliveryStats(c);
      if (stats.isEffectivelyComplete) continue;
      totalRemaining += quantityInBushels(c, stats.remaining, lbsPerBushelByCode) ?? 0;
    }

    parts.push(`On the contract side, they currently have ${openContracts.length} contract${openContracts.length !== 1 ? 's' : ''} totaling ${this._formatQuantity(totalVolume, 'bushels')}.`);

    if (totalRemaining > 0) {
      parts.push(`${this._formatQuantity(Math.round(totalRemaining), 'bushels')} remain unshipped.`);
    }

    // Worth-noting only carries items that aren't already covered by Action Items
    // (overdue + unsigned are surfaced there with bushel totals — listing them here
    // too duplicated the same fact in two places).
    const notes: string[] = [];
    if (pendingContracts.length > 0) notes.push(`${pendingContracts.length} pending`);

    if (notes.length > 0) {
      parts.push(`Worth noting: ${notes.join(', ')}.`);
    }

    return parts.join(' ');
  }

  /** Year-over-year harvest contract pace — same logic as the Contract Pacing card.
   *  Compares total contracted bushels for this calendar year vs last year, gated by
   *  active harvest windows so the comparison is apples-to-apples (same delivery window). */
  private _generateHarvestPaceSummary(): string {
    const open = this.contracts() || [];
    const historical = this.historicalContracts() || [];
    if (open.length === 0 && historical.length === 0) return '';

    const windows = (this.appState.harvestWindows() || []).filter(hw => hw.isActive !== false);
    if (windows.length === 0) return '';

    // Merge open + historical (de-duped by id) the same way the pacing card does.
    const seen = new Set<number>();
    const allContracts: Contract[] = [];
    for (const c of [...open, ...historical]) {
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      allContracts.push(c);
    }

    const year = new Date().getFullYear();
    const priorYear = year - 1;

    let totalThisYear = 0;
    let totalLastYear = 0;
    for (const hw of windows) {
      for (const c of allContracts) {
        if (!this._contractMatchesCommodity(c, hw.commodity)) continue;
        if (this._contractMatchesHarvestWindow(c, hw, year)) totalThisYear += c.quantity || 0;
        if (this._contractMatchesHarvestWindow(c, hw, priorYear)) totalLastYear += c.quantity || 0;
      }
    }

    if (totalThisYear === 0 && totalLastYear === 0) return '';

    if (totalThisYear > 0 && totalLastYear > 0) {
      const pct = Math.round(((totalThisYear - totalLastYear) / totalLastYear) * 100);
      const lead = `Harvest contract pace: ${this._formatQuantity(totalThisYear, 'bushels')} booked for ${year} vs ${this._formatQuantity(totalLastYear, 'bushels')} for ${priorYear}`;
      if (pct > 0) return `${lead} — running ${pct}% ahead of last year.`;
      if (pct < 0) return `${lead} — running ${Math.abs(pct)}% behind last year.`;
      return `${lead} — even with last year.`;
    }
    if (totalThisYear > 0) {
      return `Harvest contract pace: ${this._formatQuantity(totalThisYear, 'bushels')} booked for ${year} (no comparable ${priorYear} contracts to pace against).`;
    }
    return `Harvest contract pace: ${this._formatQuantity(totalLastYear, 'bushels')} booked for ${priorYear}, none yet booked for ${year}.`;
  }

  /** Match a contract's commodity to a harvest-window commodity (case-insensitive,
   *  checks group/description/code). Mirrors contract-pacing-card.contractMatchesCommodity. */
  private _contractMatchesCommodity(c: Contract, hwCommodity: string): boolean {
    const target = (hwCommodity || '').trim().toUpperCase();
    if (!target) return false;
    const group = (c.commodityGroup || '').trim().toUpperCase();
    if (group && group === target) return true;
    const desc = (c.commodityDescription || '').trim().toUpperCase();
    if (desc && desc.includes(target)) return true;
    const code = (c.commodityCode || '').trim().toUpperCase();
    if (code && code.includes(target)) return true;
    return false;
  }

  /** Returns true if the contract's delivery period overlaps the harvest window for
   *  `cropYear`. Mirrors contract-pacing-card.contractMatchesHarvestWindow. */
  private _contractMatchesHarvestWindow(c: Contract, hw: HarvestWindow, cropYear: number): boolean {
    if (!c.deliveryStart && !c.deliveryEnd) return false;
    const windowStart = new Date(cropYear, hw.deliveryStartMonth - 1, hw.deliveryStartDay);
    const windowEnd = new Date(cropYear, hw.deliveryEndMonth - 1, hw.deliveryEndDay);
    windowEnd.setHours(23, 59, 59, 999);
    const delStart = c.deliveryStart ? new Date(c.deliveryStart) : new Date(c.deliveryEnd!);
    const delEnd = c.deliveryEnd ? new Date(c.deliveryEnd) : new Date(c.deliveryStart!);
    return delStart <= windowEnd && delEnd >= windowStart;
  }

  private _generatePlantingOverview(): string {
    if (!this.plantingIntentions() || this.plantingIntentions().length === 0) return '';

    // Group by crop with null safety
    const cropGroups = this.plantingIntentions().reduce((acc, p) => {
      if (!p || !p.crop) return acc; // Skip invalid entries

      const crop = p.crop;
      if (!acc[crop]) {
        acc[crop] = { acres: 0 };
      }
      acc[crop].acres += p.acres || 0;
      return acc;
    }, {} as Record<string, { acres: number }>);

    // Check if we have valid data after filtering
    if (Object.keys(cropGroups).length === 0) return '';

    // Planting details with natural flow
    const cropEntries = Object.entries(cropGroups);
    let crops: string;

    if (cropEntries.length === 1) {
      const [crop, data] = cropEntries[0];
      crops = `${this._formatQuantity(data.acres, 'acres')} of ${crop}`;
    } else if (cropEntries.length === 2) {
      crops = cropEntries.map(([crop, data]) => `${this._formatQuantity(data.acres, 'acres')} of ${crop}`).join(' and ');
    } else {
      const lastCrop = cropEntries[cropEntries.length - 1];
      const otherCrops = cropEntries.slice(0, -1);
      crops = otherCrops.map(([crop, data]) => `${this._formatQuantity(data.acres, 'acres')} of ${crop}`).join(', ') +
              `, and ${this._formatQuantity(lastCrop[1].acres, 'acres')} of ${lastCrop[0]}`;
    }

    return `Planting intentions on file: ${crops}.`;
  }

  private _generateStorageSummary(): string {
    if (!this.storedGrain() || this.storedGrain().length === 0) return '';

    // Group by crop, summing quantity and receivableAmount per commodity
    const cropGroups = this.storedGrain().reduce((acc, s) => {
      if (!s || !s.crop) return acc;
      const crop = s.crop;
      if (!acc[crop]) acc[crop] = { quantity: 0, receivableAmount: 0 };
      acc[crop].quantity += s.quantity || 0;
      acc[crop].receivableAmount += s.receivableAmount || 0;
      return acc;
    }, {} as Record<string, { quantity: number; receivableAmount: number }>);

    const entries = Object.entries(cropGroups);
    if (entries.length === 0) return '';

    const parts = entries.map(([crop, data]) =>
      `${this._formatQuantity(Math.round(data.quantity), 'bushels')} of ${crop} with an accumulated cost of ${this._formatCurrency(data.receivableAmount)}`
    );

    if (parts.length === 1) {
      return `Currently holding ${parts[0]}.`;
    }
    const last = parts[parts.length - 1];
    const rest = parts.slice(0, -1).join(', ');
    return `Currently holding ${rest}, and ${last}.`;
  }

  /** Surfaces unapplied tickets only — same `!t.isApplied` filter the Unapplied Tickets
   *  tab uses, with appliedDockQuantity (post-dock-deduction) summed via per-ticket GNP024
   *  conversion to bushels. Applied tickets are already represented through the contract
   *  Delivered / Remaining numbers, so no need to double-count them here. */
  private _generateDeliverySummary(): string {
    const unapplied = (this.tickets() || []).filter(t => t && !t.isApplied);
    if (unapplied.length === 0) return '';

    const bushelTotal = this._sumTicketsAsBushels(unapplied);
    const totalStr = bushelTotal != null && bushelTotal > 0
      ? ` (${this._formatQuantity(Math.round(bushelTotal), 'bushels')})`
      : '';

    const parts: string[] = [];
    parts.push(`${unapplied.length} unapplied ticket${unapplied.length !== 1 ? 's' : ''}${totalStr} not yet matched to a contract.`);

    // Quality averages on unapplied tickets — useful context for spot-load conversations.
    const withMoisture = unapplied.filter(t => typeof t.moisture === 'number' && !isNaN(t.moisture) && t.moisture > 0);
    const withTestWeight = unapplied.filter(t => typeof t.testWeight === 'number' && !isNaN(t.testWeight) && t.testWeight > 0);
    if (withMoisture.length > 0 && withTestWeight.length > 0) {
      const avgMoisture = withMoisture.reduce((s, t) => s + (t.moisture || 0), 0) / withMoisture.length;
      const avgTestWeight = withTestWeight.reduce((s, t) => s + (t.testWeight || 0), 0) / withTestWeight.length;
      parts.push(`Avg quality: ${avgMoisture.toFixed(1)}% moisture, ${avgTestWeight.toFixed(1)} lbs/bu test weight.`);
    }

    return parts.join(' ');
  }

  /** Sum a ticket list's appliedDockQuantity to bushels, converting per-ticket via GNP024.
   *  Returns null when GNP024 isn't loaded yet. Tickets whose commodity isn't in GNP024
   *  are silently dropped from the total (matches how contracts-table treats missing
   *  conversions — better to under-report than display a misleading number).
   *  Uses appliedDockQuantity (the same field tickets-table sums for unapplied groups)
   *  rather than raw netWeight so totals match what the producer sees there. */
  private _sumTicketsAsBushels(tickets: Ticket[]): number | null {
    if (this.appState.commodityConversions().length === 0) return null;
    let total = 0;
    for (const t of tickets) {
      const lbsPerBu = this._lbsPerBushel(t.productCode);
      if (lbsPerBu == null) continue;
      total += (t.appliedDockQuantity || 0) / lbsPerBu;
    }
    return total;
  }

  private _generateEngagementSummary(): string {
    if (!this.notes() || this.notes().length === 0) return '';

    // Aggregate notes across the linked-producer group so every linked customer's
    // Activity Summary shows the same "last contact" line — whichever pinned-or-newest
    // note wins across the group surfaces on each member's summary. Falls back to this
    // customer's own notes when no linked group is loaded yet.
    const currentCustomer = this.customer();
    const linked = this.linkedCustomers() || [];
    const groupIds = new Set<number>();
    if (currentCustomer) groupIds.add(currentCustomer.id);
    for (const c of linked) groupIds.add(c.id);
    const ownNotes = groupIds.size > 0
      ? this.notes().filter(n => n && groupIds.has(n.customerId))
      : this.notes();

    // Filter valid notes with dates
    const validNotes = ownNotes.filter(n => n && n.createdAt);
    if (validNotes.length === 0) return '';

    // Prefer pinned note; fall back to most recent
    try {
      const sorted = [...validNotes].sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        if (isNaN(dateA)) return 1;
        if (isNaN(dateB)) return -1;
        return dateB - dateA;
      });

      const pinnedNote = sorted.find(n => n.isPinned);
      const lastNote = pinnedNote || sorted[0];
      if (!lastNote) return '';

      const lastDate = parseServerTime(lastNote.createdAt);
      if (isNaN(lastDate.getTime())) return '';

      const daysSince = Math.max(0, this._calendarDaysBetween(lastDate, new Date()));
      const createdBy = lastNote.createdBy || 'Unknown';

      const content = (lastNote.content || '').trim();
      // Show full content for pinned notes; truncate others to 150 chars
      const preview = pinnedNote ? content : (content.length > 150 ? content.substring(0, 150) + '…' : content);
      const previewStr = preview ? ` — "${preview}"` : '';

      // When the winning note belongs to a linked producer (not the current customer),
      // call out which producer so the merchandiser knows the context. Prefer the
      // primary contact name (who the merchandiser actually talks to) over the legal
      // producer/business name — same rule the customer intro uses.
      let sourceStr = '';
      if (currentCustomer && lastNote.customerId !== currentCustomer.id) {
        const sourceCustomer = linked.find(c => c.id === lastNote.customerId);
        const sourceName = sourceCustomer?.primaryContact?.trim() || sourceCustomer?.name?.trim();
        if (sourceName) sourceStr = ` on ${sourceName}`;
      }

      if (daysSince === 0) {
        return `Last contact was today by ${createdBy}${sourceStr}${previewStr}.`;
      } else if (daysSince === 1) {
        return `Last contact was yesterday by ${createdBy}${sourceStr}${previewStr}.`;
      } else {
        return `Last contact was ${daysSince} days ago by ${createdBy}${sourceStr}${previewStr}.`;
      }
    } catch {
      return '';
    }
  }

  private _generateActionItems(): string {
    const openOnly = (this.contracts() || []).filter(c => c && !c.closedDate);
    const now = new Date();
    const alerts: string[] = [];

    // Overdue contracts — past delivery end date AND shared delivery stats say still
    // unshipped. Same rule contracts-table + Insights use.
    const overdueContracts: Contract[] = [];
    let overdueRemainingBu = 0;
    for (const c of openOnly) {
      if (!c.deliveryEnd) continue;
      const endDate = new Date(c.deliveryEnd);
      if (isNaN(endDate.getTime()) || endDate >= now) continue;
      if (!(c.status === 'Active' || c.status === 'Pending' || c.status === 'Overdue')) continue;
      const stats = getContractDeliveryStats(c);
      if (stats.isEffectivelyComplete) continue;
      overdueContracts.push(c);
      overdueRemainingBu += stats.remaining;
    }

    if (overdueContracts.length > 0) {
      const balanceStr = overdueRemainingBu > 0
        ? ` with ${this._formatQuantity(Math.round(overdueRemainingBu), 'bushels')} still unshipped`
        : '';
      alerts.push(`${overdueContracts.length} contract${overdueContracts.length !== 1 ? 's have' : ' has'} passed the delivery deadline${balanceStr}`);
    }

    const unsignedContracts = openOnly.filter(c => c.signed === false);
    if (unsignedContracts.length > 0) {
      alerts.push(`${unsignedContracts.length} contract${unsignedContracts.length !== 1 ? 's are' : ' is'} still unsigned`);
    }

    const upcomingDeliveries = openOnly
      .filter(c => {
        if (!c || !c.deliveryEnd || c.status !== 'Active') return false;
        try {
          const endDate = new Date(c.deliveryEnd);
          return !isNaN(endDate.getTime()) && endDate >= now;
        } catch { return false; }
      })
      .sort((a, b) => new Date(a.deliveryEnd).getTime() - new Date(b.deliveryEnd).getTime());

    if (upcomingDeliveries.length > 0) {
      const nextContract = upcomingDeliveries[0];
      try {
        // Calendar-day diff so "deadline 4/30, today 4/29" reads as 1 day, not 0.
        const daysRemaining = this._calendarDaysBetween(now, new Date(nextContract.deliveryEnd));
        if (daysRemaining <= 30 && daysRemaining >= 0) {
          const crop = nextContract.commodityCode || nextContract.commodityDescription || 'grain';
          // Identify the specific contract so the alert isn't ambiguous when the customer
          // has multiple contracts in flight (e.g. 5 pending, several past-due).
          const contractId = nextContract.sourceContractId || nextContract.contractNumber || '';
          const contractStr = contractId ? `contract ${contractId}` : 'their next contract';
          const cropStr = crop ? ` (${crop})` : '';
          if (daysRemaining === 0) {
            alerts.push(`${contractStr}${cropStr} closes today`);
          } else if (daysRemaining <= 7) {
            alerts.push(`${contractStr}${cropStr} closes in just ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`);
          } else {
            alerts.push(`${contractStr}${cropStr} delivery deadline is ${daysRemaining} days away`);
          }
        }
      } catch { }
    }

    // Spot loads — unapplied tickets in the last 30 days with no active same-commodity
    // contract covering the ticket's date. Mirrors Insights' Spot Loads category exactly
    // so the count agrees with what shows on /insights for this customer.
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let spotLoadCount = 0;
    let spotLoadBu = 0;
    for (const t of this.tickets() || []) {
      if (!t || t.isApplied || !t.date) continue;
      const ticketDate = new Date(t.date);
      if (isNaN(ticketDate.getTime()) || ticketDate < thirtyDaysAgo) continue;
      const ticketCommodity = (t.productCode || '').trim().toUpperCase();
      const hasContractCoverage = ticketCommodity && openOnly.some(c => {
        if (c.status === 'Fulfilled' || c.status === 'Cancelled') return false;
        if ((c.commodityCode || '').trim().toUpperCase() !== ticketCommodity) return false;
        const start = new Date(c.deliveryStart);
        const end = new Date(c.deliveryEnd);
        return start <= ticketDate && end >= ticketDate;
      });
      if (hasContractCoverage) continue;
      spotLoadCount++;
      const lbsPerBu = this._lbsPerBushel(t.productCode);
      if (lbsPerBu) spotLoadBu += (t.appliedDockQuantity || 0) / lbsPerBu;
    }
    if (spotLoadCount > 0) {
      const buStr = spotLoadBu > 0 ? ` (${this._formatQuantity(Math.round(spotLoadBu), 'bushels')})` : '';
      alerts.push(`${spotLoadCount} spot load${spotLoadCount !== 1 ? 's' : ''}${buStr} in the last 30 days with no contract coverage — pricing opportunity`);
    }

    // Stale contact — promote into action items when the most recent customer note is older
    // than 60 days. Computed independently of _generateEngagementSummary so the action items
    // section keeps its current-state focus (engagement is descriptive, this is actionable).
    const daysSinceContact = this._daysSinceLastNote();
    if (daysSinceContact != null && daysSinceContact >= 60) {
      alerts.push(`haven't been in contact in ${daysSinceContact} days`);
    }

    if (alerts.length === 0) return '';
    if (alerts.length === 1) return alerts[0].charAt(0).toUpperCase() + alerts[0].slice(1) + '.';
    const last = alerts[alerts.length - 1];
    const rest = alerts.slice(0, -1).join(', ');
    return rest.charAt(0).toUpperCase() + rest.slice(1) + ', and ' + last + '.';
  }

  /** Days since the most recent customer-scoped note, or null if no notes exist.
   *  Pinned-status doesn't matter here (we want recency, not relevance). Uses the same
   *  ISO-timezone-padding workaround _generateEngagementSummary uses so a pinned old
   *  note doesn't suppress a real stale-contact alert. */
  private _daysSinceLastNote(): number | null {
    if (!this.notes() || this.notes().length === 0) return null;
    if (!this.customer()) return null;
    const ownNotes = this.notes().filter(n => n && n.createdAt && n.customerId === this.customer().id);
    if (ownNotes.length === 0) return null;
    let latestMs = 0;
    for (const n of ownNotes) {
      const t = parseServerTime(n.createdAt).getTime();
      if (!isNaN(t) && t > latestMs) latestMs = t;
    }
    if (latestMs === 0) return null;
    return Math.max(0, this._calendarDaysBetween(new Date(latestMs), new Date()));
  }

  /** lbs-per-bushel from ODS GNP024, used by the unapplied/spot-load ticket sums.
   *  Delivery stats no longer need it (they use openBalanceQuantity via the shared util). */
  private _lbsPerBushel(productCode: string | undefined | null): number | null {
    const code = (productCode || '').trim().toUpperCase();
    if (!code) return null;
    const lbs = this._conversionMap().get(code);
    return lbs && lbs > 0 ? lbs : null;
  }

  // Helper utility methods

  private _formatCurrency(value: number): string {
    // Handle null, undefined, NaN, and Infinity
    if (value == null || isNaN(value) || !isFinite(value)) {
      return '$0.00';
    }
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private _formatQuantity(value: number, unit: string): string {
    // Handle null, undefined, NaN, and Infinity
    if (value == null || isNaN(value) || !isFinite(value)) {
      return `0 ${unit}`;
    }
    return `${value.toLocaleString('en-US')} ${unit}`;
  }

  /** Compare by local calendar date so "yesterday at 3pm" is always 1 day ago. */
  private _calendarDaysBetween(start: Date, end: Date): number {
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  }

  private _calculateDaysBetween(start: Date, end: Date): number {
    // Validate dates
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 0;
    }
    return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

}
