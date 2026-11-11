import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { lastValueFrom, of } from 'rxjs';
import { listsModule } from './lists.module';
import { SavedListsStore } from './data-access/saved-lists.store';
import { AddToListComponent } from './components/add-to-list/add-to-list.component';
import { SavedListFilterComponent } from './components/saved-list-filter/saved-list-filter.component';

describe('Lists module: its preload', () => {
  // The store reads only what the user may: see its own spec.
  it("reads the user's own lists and the team's for each new trade-unit selection", async () => {
    const store = { load: vi.fn(() => of(null)), loadTeamLists: vi.fn(() => of(null)) };
    TestBed.configureTestingModule({ providers: [{ provide: SavedListsStore, useValue: store }] });

    await lastValueFrom(TestBed.runInInjectionContext(() => listsModule.preload!(['TU1'])), { defaultValue: null });

    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.loadTeamLists).toHaveBeenCalledTimes(1);
  });
});

describe('Lists module: Add to List on the customer screen', () => {
  const panels = () => (listsModule.customerPanels ?? []).filter(p => p.slot === 'toolbar');

  // First of the header's buttons: Producers' Print is 90 and Edit 100.
  it("adds Add to List to the profile header's buttons, first, for every customer", () => {
    expect(panels().map(p => [p.slot, p.id, p.order])).toEqual([['toolbar', 'add-to-list', 10]]);
    expect(panels()[0].segments ?? []).toEqual([]);
  });

describe("Lists module: the saved-list picker in the customer list's filter slot", () => {
  const picker = () => (listsModule.customerPanels ?? []).find(p => p.slot === 'list-filter')!;

  // For every customer; it offers the user's own lists, so it needs their read.
  it('fills the list-filter slot for a user who may read their own lists', () => {
    expect([picker().id, picker().order, picker().requires, picker().segments ?? []]).toEqual(['saved-list-filter', 10, ['saved-lists:read:own'], []]);
  });

  it('loads as its panel', async () => {
    expect(await picker().component()).toBe(SavedListFilterComponent);
  });
});

  // It reads the user's own lists and changes them; its Team Lists tab checks the team permissions itself.
  it('needs the read and the write on your own saved lists', () => {
    expect(panels()[0].requires).toEqual(['saved-lists:read:own', 'saved-lists:write:own']);
  });

  it('loads as its panel', async () => {
    expect(await panels()[0].component()).toBe(AddToListComponent);
  });
});
