import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { WhatsNewDialogComponent } from './whats-new-dialog.component';
import { provideTestEnvironment } from '@testing/test-providers';
import type { WhatsNewRelease } from '@models';

const releases: WhatsNewRelease[] = [
  {
    version: '2026.09.1',
    releasedOn: '2026-09-15',
    title: 'A September release',
    summary: 'Two areas changed.',
    items: [
      { kind: 'added', text: 'Bid sheets gained a thing.', group: 'Bid Sheet' },
      { kind: 'fixed', text: 'Notes stopped doing a thing.', group: 'Notes' }
    ]
  }
];

async function renderDialog(isOpen: boolean, onClose = vi.fn()) {
  await render(WhatsNewDialogComponent, {
    providers: provideTestEnvironment(),
    inputs: { isOpen, releases },
    on: { close: onClose }
  });
  return onClose;
}

describe('WhatsNewDialogComponent', () => {
  it('renders nothing while closed', async () => {
    await renderDialog(false);

    expect(screen.queryByText(/Bid sheets gained a thing/)).toBeNull();
  });

  it('renders the grouped items and kind labels', async () => {
    await renderDialog(true);

    expect(screen.getByText(/Bid sheets gained a thing/)).toBeTruthy();
    expect(screen.getByText('Bid Sheet')).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
    // "added" and "fixed" are developer words — the user sees New and Fixed.
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('Fixed')).toBeTruthy();
  });

  it('omits the release title and summary, which the dialog header already covers', async () => {
    // Repeating them here would only push the features further down.
    await renderDialog(true);

    expect(screen.queryByText('A September release')).toBeNull();
    expect(screen.queryByText('Two areas changed.')).toBeNull();
  });

  it('renders nothing when open with no releases', async () => {
    // The dialog closes itself if the list empties underneath it.
    const onClose = vi.fn();
    await render(WhatsNewDialogComponent, {
      providers: provideTestEnvironment(),
      inputs: { isOpen: true, releases: [] as WhatsNewRelease[] },
      on: { close: onClose }
    });

    expect(screen.queryByRole('button', { name: /got it/i })).toBeNull();
  });

  it('emits close when Got it is clicked', async () => {
    const onClose = await renderDialog(true);

    await userEvent.click(screen.getByRole('button', { name: /got it/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('emits close on Escape while open', async () => {
    const onClose = await renderDialog(true);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('ignores Escape while closed', async () => {
    const onClose = await renderDialog(false);

    await userEvent.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });
});
