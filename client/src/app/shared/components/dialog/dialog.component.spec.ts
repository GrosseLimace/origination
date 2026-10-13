import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import {
  DialogComponent,
  DialogHeaderComponent,
  DialogTitleComponent,
  DialogDescriptionComponent,
  DialogContentComponent,
  DialogFooterComponent,
} from './dialog.component';

const DIALOG_PARTS = [
  DialogComponent,
  DialogHeaderComponent,
  DialogTitleComponent,
  DialogDescriptionComponent,
  DialogContentComponent,
  DialogFooterComponent,
];

// Behavior-focused (style-guides/automated-testing.md §7.2/§7.4): what matters is whether
// the dialog is on screen, which clicks close it, and the body-scroll lock — not its
// Tailwind sizing classes.
describe('DialogComponent', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  function renderDialog(extraAttrs = '', props: Record<string, unknown> = {}) {
    return render(
      `<app-dialog [isOpen]="isOpen" (close)="close()" ${extraAttrs}>
        <app-dialog-header>
          <app-dialog-title>Confirm delete</app-dialog-title>
          <app-dialog-description>This cannot be undone.</app-dialog-description>
        </app-dialog-header>
        <app-dialog-content><p>Body text</p></app-dialog-content>
        <app-dialog-footer><button type="button">Cancel</button></app-dialog-footer>
      </app-dialog>`,
      {
        imports: DIALOG_PARTS,
        componentProperties: { isOpen: true, close: vi.fn(), ...props },
      },
    );
  }

  /** The close "X" is icon-only, so its accessible name comes from aria-label. Querying by that
   *  name is the test that the label is present: an unlabelled button would not be found. */
  function closeButton(): HTMLElement {
    return screen.getByRole('button', { name: 'Close dialog' });
  }

  function backdropAndWrapper(container: Element): [HTMLElement, HTMLElement] {
    const host = container.querySelector('app-dialog');
    if (!host) throw new Error('app-dialog not rendered');
    // Template order: full-screen backdrop first, then the centering wrapper holding the panel.
    return [host.children[0] as HTMLElement, host.children[1] as HTMLElement];
  }

  it('should render nothing while closed', async () => {
    await renderDialog('', { isOpen: false });

    expect(screen.queryByText('Confirm delete')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should render the header, title, description, content and footer when open', async () => {
    await renderDialog();

    expect(screen.getByRole('heading', { level: 2, name: 'Confirm delete' })).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('should emit close when the X button is clicked', async () => {
    const close = vi.fn();
    await renderDialog('', { close });

    await userEvent.click(closeButton());

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('should emit close when Escape is pressed', async () => {
    const close = vi.fn();
    await renderDialog('', { close });

    await userEvent.keyboard('{Escape}');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('should ignore Escape when closeOnEscape is false', async () => {
    const close = vi.fn();
    await renderDialog('[closeOnEscape]="false"', { close });

    await userEvent.keyboard('{Escape}');

    expect(close).not.toHaveBeenCalled();
  });

  it('should ignore Escape while closed', async () => {
    // The listener is on the document for the component's whole life, so a closed dialog must
    // not emit for a keypress meant for something else on the page.
    const close = vi.fn();
    await renderDialog('', { isOpen: false, close });

    await userEvent.keyboard('{Escape}');

    expect(close).not.toHaveBeenCalled();
  });

  it('should hide the X button when showCloseButton is false', async () => {
    await renderDialog('[showCloseButton]="false"');

    // Only the projected Cancel button remains.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('should emit close when the backdrop or the area around the panel is clicked', async () => {
    const close = vi.fn();
    const { container } = await renderDialog('', { close });
    const [backdrop, wrapper] = backdropAndWrapper(container);

    await userEvent.click(backdrop);
    expect(close).toHaveBeenCalledTimes(1);

    await userEvent.click(wrapper);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('should not emit close from the backdrop when closeOnBackdrop is false, but still from the X', async () => {
    const close = vi.fn();
    const { container } = await renderDialog('[closeOnBackdrop]="false"', { close });
    const [backdrop, wrapper] = backdropAndWrapper(container);

    await userEvent.click(backdrop);
    await userEvent.click(wrapper);
    expect(close).not.toHaveBeenCalled();

    await userEvent.click(closeButton());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('should not emit close when clicking inside the panel', async () => {
    const close = vi.fn();
    await renderDialog('', { close });

    await userEvent.click(screen.getByText('Body text'));
    await userEvent.click(screen.getByRole('heading', { level: 2 }));

    expect(close).not.toHaveBeenCalled();
  });

  it('should lock body scroll while open and release it when closed', () => {
    const fixture = TestBed.createComponent(DialogComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');

    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('');
  });

  it('should release body scroll if destroyed while still open', () => {
    const fixture = TestBed.createComponent(DialogComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');

    fixture.destroy();

    expect(document.body.style.overflow).toBe('');
  });

  it('should let the content section take the panel height when scrollBody is on', async () => {
    const { container } = await renderDialog('[scrollBody]="true"');

    const content = container.querySelector('app-dialog-content') as HTMLElement;
    // display: contents is what lets the inner div become the panel's flex item.
    expect(content.style.display).toBe('contents');
  });

  it('should leave the content section as a normal block when scrollBody is off', async () => {
    const { container } = await renderDialog();

    const content = container.querySelector('app-dialog-content') as HTMLElement;
    expect(content.style.display).toBe('');
  });

  it('should size the panel from the size input', () => {
    const fixture = TestBed.createComponent(DialogComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    const widths = new Set<string>();

    for (const size of ['sm', 'md', 'lg', 'xl', '2xl', 'full'] as const) {
      fixture.componentRef.setInput('size', size);
      fixture.detectChanges();
      widths.add(fixture.componentInstance.sizeClass);
      expect(fixture.componentInstance.panelClass).toContain(fixture.componentInstance.sizeClass);
    }

    // Every size maps to a distinct panel width.
    expect(widths.size).toBe(6);
  });
});
