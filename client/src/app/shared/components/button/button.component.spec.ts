import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { ButtonComponent } from './button.component';

// Behavior-focused (style-guides/automated-testing.md §7.2/§7.4): query by accessible role,
// assert visible behavior — never Tailwind class names.
describe('ButtonComponent', () => {
  it('should render projected content as an accessible button', async () => {
    await render('<app-button>Save bid</app-button>', { imports: [ButtonComponent] });

    expect(screen.getByRole('button', { name: /save bid/i })).toBeInTheDocument();
  });

  it('should emit onClick when enabled and clicked', async () => {
    const onClick = vi.fn();
    await render('<app-button (onClick)="onClick($event)">Save</app-button>', {
      imports: [ButtonComponent],
      componentProperties: { onClick },
    });

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should be disabled and not emit when the disabled input is set', async () => {
    const onClick = vi.fn();
    await render('<app-button [disabled]="true" (onClick)="onClick($event)">Save</app-button>', {
      imports: [ButtonComponent],
      componentProperties: { onClick },
    });

    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
