import { render, screen } from '@testing-library/angular';
import { BadgeComponent } from './badge.component';

// Presentational component: assert the projected text is visible, not the utility classes
// it happens to apply (style-guides/automated-testing.md §7.4).
describe('BadgeComponent', () => {
  it('should render projected content', async () => {
    await render('<app-badge>Active</app-badge>', { imports: [BadgeComponent] });

    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should still render its content for a non-default variant', async () => {
    await render('<app-badge variant="success">Priced</app-badge>', { imports: [BadgeComponent] });

    expect(screen.getByText('Priced')).toBeInTheDocument();
  });
});
