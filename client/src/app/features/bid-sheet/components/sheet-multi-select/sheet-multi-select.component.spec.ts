import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import type { BidSheet } from '@models';
import { SheetMultiSelectComponent } from './sheet-multi-select.component';

const sheet = (id: number, name: string, over: Partial<BidSheet> = {}): BidSheet =>
  ({ id, name, ownerUserId: 'CEgr', isOwner: true, shares: [], ...over }) as BidSheet;

const KS = sheet(1, 'Kansas');
const NE = sheet(2, 'Nebraska', { isOwner: false, ownerUserId: 'JDoe' });
const IA = sheet(3, 'Iowa', { shares: [{ memberType: 'person', memberId: 'JDoe', userId: 'JDoe' }] as BidSheet['shares'] });

type Inputs = Partial<{
  sheets: BidSheet[]; selectedIds: number[]; showAllOption: boolean; showingAll: boolean; showRowActions: boolean;
}>;

/** Renders the control with spies on every output, through the real template. */
async function setup(inputs: Inputs = {}) {
  const outputs = {
    toggled: vi.fn(), pickedOnly: vi.fn(), pickedAll: vi.fn(),
    sharedSheet: vi.fn(), renamedSheet: vi.fn(), deletedSheet: vi.fn(),
  };
  await render(SheetMultiSelectComponent, {
    inputs: { sheets: [KS, NE, IA], selectedIds: [], ...inputs },
    on: outputs,
  });
  const trigger = () => screen.getAllByRole('button')[0];
  const openList = () => userEvent.click(trigger());
  const isOpen = () => screen.queryByRole('button', { name: 'Done' }) !== null;
  return { outputs, trigger, openList, isOpen };
}

describe('SheetMultiSelectComponent', () => {
  describe('the closed control', () => {
    it.each([
      [{ sheets: [] }, 'No bid sheets yet'],
      [{ selectedIds: [] }, 'Choose a bid sheet'],
      [{ selectedIds: [2] }, 'Nebraska'],
      [{ selectedIds: [2, 1] }, 'Nebraska + Kansas'],          // tick order, not list order
      [{ selectedIds: [1, 2, 3] }, '3 bid sheets'],
      [{ selectedIds: [1, 99] }, 'Kansas'],                     // an id with no sheet is ignored
      [{ selectedIds: [1], showingAll: true }, 'All locations'],
    ] as [Inputs, string][])('with %o reads "%s"', async (inputs, label) => {
      const { trigger } = await setup(inputs);
      expect(trigger().textContent?.trim()).toBe(label);
    });

    it('says which surface it controls in its tooltip', async () => {
      const { trigger } = await setup({ showAllOption: true });
      expect(trigger().getAttribute('title')).toBe('Which bid sheets the map and panel are showing');
    });
  });

  describe('opening and closing', () => {
    it('opens on the trigger and closes on Done, the backdrop, or the trigger again', async () => {
      const { openList, isOpen, trigger } = await setup();
      expect(isOpen()).toBe(false);

      await openList();
      expect(isOpen()).toBe(true);
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(isOpen()).toBe(false);

      await openList();
      const backdrop = document.querySelector('div.fixed.inset-0') as HTMLElement;
      await userEvent.click(backdrop);
      expect(isOpen()).toBe(false);

      await openList();
      await userEvent.click(trigger());
      expect(isOpen()).toBe(false);
    });

    it('lists "No bid sheets yet" when there are none', async () => {
      const { openList } = await setup({ sheets: [] });
      await openList();
      expect(screen.getAllByText('No bid sheets yet').length).toBeGreaterThan(0);
      expect(screen.queryAllByRole('checkbox')).toEqual([]);
    });
  });

  describe('choosing sheets', () => {
    it('ticks the selected sheets, and none while the map shows everything', async () => {
      const { openList } = await setup({ selectedIds: [1, 3] });
      await openList();
      expect((screen.getByRole('checkbox', { name: 'Show Kansas' }) as HTMLInputElement).checked).toBe(true);
      expect((screen.getByRole('checkbox', { name: 'Show Nebraska' }) as HTMLInputElement).checked).toBe(false);
      expect((screen.getByRole('checkbox', { name: 'Show Iowa' }) as HTMLInputElement).checked).toBe(true);
    });

    it('shows nothing ticked while the map is unscoped', async () => {
      const { openList } = await setup({ selectedIds: [1, 3], showingAll: true, showAllOption: true });
      await openList();
      expect(screen.getAllByRole('checkbox').every(c => !(c as HTMLInputElement).checked)).toBe(true);
    });

    it('a checkbox adds or removes one sheet and leaves the list open', async () => {
      const { outputs, openList, isOpen } = await setup({ selectedIds: [1] });
      await openList();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Show Nebraska' }));
      expect(outputs.toggled).toHaveBeenCalledWith(2);
      expect(outputs.pickedOnly).not.toHaveBeenCalled();
      expect(isOpen()).toBe(true);
    });

    it('a sheet name shows only that sheet and closes the list', async () => {
      const { outputs, openList, isOpen } = await setup({ selectedIds: [1] });
      await openList();
      await userEvent.click(screen.getByRole('button', { name: 'Nebraska' }));
      expect(outputs.pickedOnly).toHaveBeenCalledWith(2);
      expect(outputs.toggled).not.toHaveBeenCalled();
      expect(isOpen()).toBe(false);
    });

    it('offers "All locations" only where asked', async () => {
      const without = await setup({ showAllOption: false });
      await without.openList();
      expect(screen.queryByRole('button', { name: 'All locations' })).toBeNull();
    });

    it('"All locations" reports the choice and closes the list', async () => {
      const { outputs, openList, isOpen } = await setup({ showAllOption: true });
      await openList();
      await userEvent.click(screen.getByRole('button', { name: 'All locations' }));
      expect(outputs.pickedAll).toHaveBeenCalledTimes(1);
      expect(isOpen()).toBe(false);
    });
  });

  describe('per-sheet actions', () => {
    it('are hidden unless asked for', async () => {
      const { openList } = await setup({ showRowActions: false });
      await openList();
      expect(screen.queryByRole('button', { name: /^Share / })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Rename / })).toBeNull();
    });

    it('share and rename for every sheet, delete only for the sheets you own', async () => {
      const { openList } = await setup({ showRowActions: true });
      await openList();
      expect(screen.getAllByRole('button', { name: /^Share / })).toHaveLength(3);
      expect(screen.getAllByRole('button', { name: /^Rename / })).toHaveLength(3);
      expect(screen.getAllByRole('button', { name: /^Delete / }).map(b => b.getAttribute('aria-label')))
        .toEqual(['Delete Kansas', 'Delete Iowa']);
      // A sheet shared with you is marked as such.
      expect(screen.getAllByText('shared')).toHaveLength(1);
      // The share button says how many it is shared with.
      expect(screen.getByRole('button', { name: 'Share Iowa' }).getAttribute('title')).toBe('Share (1)');
      expect(screen.getByRole('button', { name: 'Share Kansas' }).getAttribute('title')).toBe('Share this sheet');
    });

    it.each([
      ['Share Nebraska', 'sharedSheet', 2],
      ['Rename Nebraska', 'renamedSheet', 2],
      ['Delete Kansas', 'deletedSheet', 1],
    ] as const)('"%s" raises %s for that sheet and closes the list', async (label, output, id) => {
      const { outputs, openList, isOpen } = await setup({ showRowActions: true });
      await openList();
      await userEvent.click(screen.getByRole('button', { name: label }));
      expect(outputs[output]).toHaveBeenCalledWith(id);
      expect(isOpen()).toBe(false);
    });
  });
});
