import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Customer, SavedList } from '@models';
import { CustomerScreenSources, customerScreenSources } from '@testing/customer-screen-sources';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { SavedListMembershipFake, provideSavedListMembership, savedListMembershipFake } from '@testing/saved-list-membership.fake';
import { AddToListComponent } from './add-to-list.component';

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', location: '', phone: '', email: '', 
    eSignEnabled: false, achEnabled: false, ...over,
  };
}

function makeList(over: Partial<SavedList> = {}): SavedList {
  return { id: 1, name: 'List', query: 'corn', createdAt: '2026-01-01', ...over };
}

describe('AddToListComponent', () => {
  let fixture: ComponentFixture<AddToListComponent>;
  let component: AddToListComponent;
  let sources: CustomerScreenSources;
  let membership: SavedListMembershipFake;
  let permissions: PermissionStub;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const text = (): string => squash(host().textContent);
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(host().querySelectorAll('button')).find(b => squash(b.textContent) === label);
  const menuButton = (): HTMLButtonElement => host().querySelector<HTMLButtonElement>('button[title="Add this producer to a saved list"]')!;
  const checkbox = (listName: string): HTMLInputElement =>
    Array.from(host().querySelectorAll('label')).find(l => l.textContent?.includes(listName))!.querySelector('input')!;
  const ticked = (): string[] =>
    Array.from(host().querySelectorAll('label')).filter(l => l.querySelector('input')!.checked).map(l => squash(l.textContent));
  const menuOpen = (): boolean => text().includes('Saved Lists');

  function click(el: Element | null | undefined): void {
    if (!el) throw new Error('nothing to click');
    (el as HTMLElement).click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    sources = customerScreenSources();
    membership = savedListMembershipFake();
    permissions = permissionStub(['saved-lists:read:own', 'saved-lists:write:own']);
    await TestBed.configureTestingModule({
      imports: [AddToListComponent],
      providers: [...sources.providers, provideSavedListMembership(membership), providePermissions(permissions)],
    }).compileComponents();
    sources.customer.set(makeCustomer({ id: 42 }));
    fixture = TestBed.createComponent(AddToListComponent);
    component = fixture.componentInstance;
    // Settle the customer effect first: a customer change closes the dropdown.
    fixture.detectChanges();
  });

  // An exclusion wins over a manual add, and a manual add over the members the page resolved from the list's query.
  it("ticks the lists the customer on screen is in, the way the page resolved them", () => {
    membership.ownLists.set([
      makeList({ id: 1, name: 'Queried', customerIds: [42] }),
      makeList({ id: 2, name: 'Added', includedCustomerIds: [42] }),
      makeList({ id: 3, name: 'Excluded', customerIds: [42], includedCustomerIds: [42], excludedCustomerIds: [42] }),
      makeList({ id: 4, name: 'Someone else', customerIds: [7] }),
    ]);
    click(menuButton());

    expect(ticked()).toEqual(['Queried', 'Added']);
  });

  it('stages ticks until Save, then hands the changes to the page and closes', () => {
    membership.ownLists.set([makeList({ id: 1, name: 'In it', customerIds: [42] }), makeList({ id: 2, name: 'Not in it' })]);
    click(menuButton());
    expect(button('Save')!.disabled).toBe(true);

    click(checkbox('In it'));
    click(checkbox('Not in it'));
    expect(membership.save).not.toHaveBeenCalled();
    click(button('Save'));

    expect(membership.save).toHaveBeenCalledWith([{ listId: 1, add: false }, { listId: 2, add: true }]);
    expect(menuOpen()).toBe(false);
  });

  it('saves nothing when the ticks are put back as they were', () => {
    membership.ownLists.set([makeList({ id: 1, name: 'My List' })]);
    click(menuButton());
    click(checkbox('My List'));
    click(checkbox('My List'));

    expect(button('Save')!.disabled).toBe(true);
    component.save();
    expect(membership.save).not.toHaveBeenCalled();
  });

  it('Cancel discards what was staged, and the next open starts from the saved membership', () => {
    membership.ownLists.set([makeList({ id: 1, name: 'My List' })]);
    click(menuButton());
    click(checkbox('My List'));
    click(button('Cancel'));
    expect(menuOpen()).toBe(false);

    click(menuButton());
    expect(ticked()).toEqual([]);
    expect(membership.save).not.toHaveBeenCalled();
  });

  it('closes and discards on a click outside it, on Escape, and for another customer', () => {
    membership.ownLists.set([makeList({ id: 1, name: 'My List' })]);
    const reopenAndStage = () => { click(menuButton()); click(checkbox('My List')); };

    reopenAndStage();
    click(document.body);
    expect(menuOpen()).toBe(false);

    reopenAndStage();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(menuOpen()).toBe(false);

    reopenAndStage();
    sources.customer.set(makeCustomer({ id: 7 }));
    fixture.detectChanges();
    expect(menuOpen()).toBe(false);

    expect(component.stagedMembership().size).toBe(0);
    expect(membership.save).not.toHaveBeenCalled();
  });

  it('stays open for clicks inside it', () => {
    membership.ownLists.set([makeList({ id: 1, name: 'My List' })]);
    click(menuButton());
    click(checkbox('My List'));
    expect(menuOpen()).toBe(true);
  });

  describe('the Team Lists tab', () => {
    beforeEach(() => {
      membership.ownLists.set([makeList({ id: 1, name: 'My List' })]);
      membership.teamLists.set([makeList({ id: 2, name: "Joe's List", createdBy: 'Joe' })]);
    });

    it('needs both team permissions', () => {
      permissions.grant('saved-lists:read:own', 'saved-lists:write:own', 'saved-lists:read:team');
      click(menuButton());
      expect(button('Team Lists')).toBeUndefined();

      click(menuButton());
      permissions.grant('saved-lists:read:own', 'saved-lists:write:own', 'saved-lists:read:team', 'saved-lists:write:team');
      click(menuButton());
      expect(button('Team Lists')).toBeDefined();
    });

    it("shows the team's lists with who they are for, and saves changes on both tabs together", () => {
      permissions.grant('saved-lists:read:own', 'saved-lists:write:own', 'saved-lists:read:team', 'saved-lists:write:team');
      click(menuButton());
      click(checkbox('My List'));
      click(button('Team Lists'));
      const row = Array.from(host().querySelectorAll('label')).find(l => l.textContent?.includes("Joe's List"))!;
      expect(Array.from(row.querySelectorAll('span span')).map(s => squash(s.textContent))).toEqual(["Joe's List", 'Joe']);
      click(checkbox("Joe's List"));
      click(button('Save'));

      expect(membership.save).toHaveBeenCalledWith([{ listId: 1, add: true }, { listId: 2, add: true }]);
    });

    it('leaves team lists out of the save without the team permissions', () => {
      click(menuButton());
      component.toggleStaged(makeList({ id: 1 }));
      component.toggleStaged(makeList({ id: 2 }));
      component.save();

      expect(membership.save).toHaveBeenCalledWith([{ listId: 1, add: true }]);
    });
  });

  describe('with no lists to show', () => {
    it('says the saved lists could not be loaded instead of "No saved lists match"', () => {
      membership.ownListsLoadFailed.set(true);
      click(menuButton());

      expect(text()).toContain("Couldn't load your saved lists. Refresh the page to try again.");
      expect(text()).not.toContain('No saved lists match the selected trade unit(s).');
    });

    it('says "No saved lists match" when nothing failed, and offers only Close', () => {
      click(menuButton());

      expect(text()).toContain('No saved lists match the selected trade unit(s).');
      expect(text()).not.toContain("Couldn't load your saved lists");
      expect(button('Save')).toBeUndefined();
      click(button('Close'));
      expect(menuOpen()).toBe(false);
    });

    it('lists the saved lists it has, whatever the flag says', () => {
      membership.ownListsLoadFailed.set(true);
      membership.ownLists.set([makeList({ id: 1, name: 'My List' })]);
      click(menuButton());

      expect(text()).toContain('My List');
      expect(text()).not.toContain("Couldn't load your saved lists");
    });

    it("leaves the Team Lists tab as it was: the flag is about the user's own lists", () => {
      permissions.grant('saved-lists:read:own', 'saved-lists:write:own', 'saved-lists:read:team', 'saved-lists:write:team');
      membership.ownListsLoadFailed.set(true);
      click(menuButton());
      click(button('Team Lists'));

      expect(text()).toContain('No team lists tied to the selected trade unit(s).');
      expect(text()).not.toContain("Couldn't load your saved lists");
    });
  });

  // The button sits in the header's row of buttons, spaced by the row's gap.
  it('takes no space in the button row but its own', () => {
    expect(host().classList).toContain('contents');
  });
});
