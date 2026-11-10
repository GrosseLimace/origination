import { describe, it, expect } from 'vitest';
import { listsModule } from './lists.module';
import { AddToListComponent } from './components/add-to-list/add-to-list.component';

describe('Lists module: Add to List on the customer screen', () => {
  const panels = () => listsModule.customerPanels ?? [];

  // First of the header's buttons: Producers' Print is 90 and Edit 100.
  it("adds Add to List to the profile header's buttons, first, for every customer", () => {
    expect(panels().map(p => [p.slot, p.id, p.order])).toEqual([['toolbar', 'add-to-list', 10]]);
    expect(panels()[0].segments ?? []).toEqual([]);
  });

  // It reads the user's own lists and changes them; its Team Lists tab checks the team permissions itself.
  it('needs the read and the write on your own saved lists', () => {
    expect(panels()[0].requires).toEqual(['saved-lists:read:own', 'saved-lists:write:own']);
  });

  it('loads as its panel', async () => {
    expect(await panels()[0].component()).toBe(AddToListComponent);
  });
});
