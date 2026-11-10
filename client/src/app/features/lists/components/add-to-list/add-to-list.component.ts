import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { PermissionService } from '@core/access/permission.service';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SavedListMembership } from '@core/context/saved-list-membership';
import { SavedList } from '@models';

/**
 * Add to List in the profile header's buttons: a dropdown of the user's saved lists, each ticked when the customer on
 * screen is in it. Ticks are staged while it is open; Save hands the changes to the page's SavedListMembership, and
 * Cancel, a click outside, Escape or another customer discards them. A user who may change teammates' lists also gets a
 * Team Lists tab, and changes on both tabs save together. Its element takes no space, so the button sits in the
 * header's row.
 */
@Component({
  selector: 'app-add-to-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents',
    // The dropdown stops its own clicks, so any click that reaches the document is outside it.
    '(document:click)': 'dismiss()',
    '(document:keydown.escape)': 'dismiss()',
  },
  templateUrl: './add-to-list.component.html',
})
export class AddToListComponent {
  private readonly membership = inject(SavedListMembership);
  private readonly access = inject(PermissionService);
  private readonly customer = inject(SelectedCustomerContext).customer;

  readonly ownLists = this.membership.ownLists;
  readonly teamLists = this.membership.teamLists;
  readonly ownListsLoadFailed = this.membership.ownListsLoadFailed;

  /** The Team Lists tab: reading teammates' lists needs the team read, and adding a customer to one changes someone
   *  else's list, which needs the team write. */
  readonly canEditTeamLists = computed(() => this.access.hasAll(['saved-lists:read:team', 'saved-lists:write:team']));

  readonly menuOpen = signal(false);
  /** Which lists the dropdown is showing: the user's own, or (with the team permissions) the team's. */
  readonly tab = signal<'saved' | 'team'>('saved');
  /** Staged membership while the dropdown is open (list id -> member?), seeded from the current membership each time
   *  it opens. Applied on Save, discarded otherwise. */
  readonly stagedMembership = signal<ReadonlyMap<number, boolean>>(new Map());

  /** The lists shown for the tab picked. */
  readonly activeLists = computed<SavedList[]>(() => this.tab() === 'team' ? this.teamLists() : this.ownLists());

  constructor() {
    // Another customer: what was staged was for the one before.
    effect(() => {
      this.customer();
      untracked(() => this.dismiss());
    });
  }

  /** Every list the dropdown can stage changes against: the user's own, plus the team's when allowed. Seeding and
   *  the save's diff span both, so a tick on either tab survives switching tabs. */
  private allLists(): SavedList[] {
    return this.canEditTeamLists() ? [...this.ownLists(), ...this.teamLists()] : this.ownLists();
  }

  /** Whether the customer on screen is in the list now, as saved. An exclusion wins, then a manual include, then the
   *  membership the page resolved from the list's query (which also covers lists whose query cached no ids). */
  isInList(list: SavedList): boolean {
    const id = this.customer()?.id;
    if (id === undefined) return false;
    if (list.excludedCustomerIds?.includes(id)) return false;
    if (list.includedCustomerIds?.includes(id)) return true;
    return (list.customerIds ?? []).includes(id);
  }

  /** A list's checkbox: what is staged for it, else its current membership. */
  isStagedMember(list: SavedList): boolean {
    return this.stagedMembership().get(list.id) ?? this.isInList(list);
  }

  /** Opens the dropdown, seeding the staged ticks from the current membership; or closes it, discarding them. */
  toggleMenu(): void {
    if (this.menuOpen()) { this.cancel(); return; }
    const seed = new Map<number, boolean>();
    for (const list of this.allLists()) seed.set(list.id, this.isInList(list));
    this.stagedMembership.set(seed);
    this.tab.set('saved');
    this.menuOpen.set(true);
  }

  /** Flips one list's staged tick; nothing is saved until Save. */
  toggleStaged(list: SavedList): void {
    const next = new Map(this.stagedMembership());
    next.set(list.id, !this.isStagedMember(list));
    this.stagedMembership.set(next);
  }

  /** True when any staged tick differs from the current membership, on either tab: Save is on. */
  hasStagedChanges(): boolean {
    return this.allLists().some(list => this.isStagedMember(list) !== this.isInList(list));
  }

  /** Hands the staged changes on both tabs to the page to save, then closes. */
  save(): void {
    const changes = this.allLists()
      .filter(list => this.isStagedMember(list) !== this.isInList(list))
      .map(list => ({ listId: list.id, add: this.isStagedMember(list) }));
    if (changes.length > 0) this.membership.save(changes);
    this.cancel();
  }

  /** Closes the dropdown and discards what was staged. */
  cancel(): void {
    this.menuOpen.set(false);
    this.tab.set('saved');
    this.stagedMembership.set(new Map());
  }

  /** Cancels, if the dropdown is open. */
  dismiss(): void {
    if (this.menuOpen()) this.cancel();
  }
}
