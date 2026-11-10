import { Signal } from '@angular/core';
import { SavedList } from '@models';

/** One change to the selected customer's membership of a saved list: added to it, or taken off it. */
export interface SavedListMembershipChange {
  listId: number;
  add: boolean;
}

/**
 * The saved lists the selected customer can be added to from the profile header's Add to List, and the save of those
 * changes. Declared in core so the Lists module's Add to List can use it without importing the page; the page hosting
 * the customer screen provides it (the home page's HomeSavedListsStore), because the page resolves which customers
 * each list holds against the data it has loaded.
 */
export abstract class SavedListMembership {
  /** The user's own lists that share a trade unit with the selection, each with the customers it holds. */
  abstract readonly ownLists: Signal<SavedList[]>;
  /** Teammates' lists tied to the selected trade units. Empty for a user without the team permissions. */
  abstract readonly teamLists: Signal<SavedList[]>;
  /** The user's own lists failed to load, so having none does not mean none match. */
  abstract readonly ownListsLoadFailed: Signal<boolean>;
  /** Saves the changes for the selected customer: each changed list once, and one message for them all. */
  abstract save(changes: readonly SavedListMembershipChange[]): void;
}
