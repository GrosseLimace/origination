import { Provider, signal } from '@angular/core';
import { vi } from 'vitest';
import { SavedList } from '@models';
import { SavedListMembership } from '@core/context/saved-list-membership';

/**
 * A SavedListMembership for specs: writable signals a test sets directly, and a spy for the save. Starts with no lists
 * and nothing failed.
 */
export function savedListMembershipFake() {
  return {
    ownLists: signal<SavedList[]>([]),
    teamLists: signal<SavedList[]>([]),
    ownListsLoadFailed: signal(false),
    save: vi.fn(),
  } satisfies SavedListMembership;
}

export type SavedListMembershipFake = ReturnType<typeof savedListMembershipFake>;

/** Provides `fake` (or an empty one) as the SavedListMembership. */
export function provideSavedListMembership(fake: SavedListMembershipFake = savedListMembershipFake()): Provider {
  return { provide: SavedListMembership, useValue: fake };
}
