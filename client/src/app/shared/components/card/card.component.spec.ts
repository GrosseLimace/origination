import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import {
  CardComponent,
  CardHeaderComponent,
  CardTitleComponent,
  CardDescriptionComponent,
  CardContentComponent,
  CardFooterComponent,
} from './card.component';

const CARD_PARTS = [
  CardComponent,
  CardHeaderComponent,
  CardTitleComponent,
  CardDescriptionComponent,
  CardContentComponent,
  CardFooterComponent,
];

// Presentational primitives: assert the projected content and its semantics (the title is a
// real heading) plus the one input each part has — a caller class appended to its wrapper.
// Not the Tailwind palette (style-guides/automated-testing.md §7.4).
describe('CardComponent', () => {
  it('should render every section with its projected content', async () => {
    await render(
      `<app-card>
        <app-card-header>
          <app-card-title>Bushels delivered</app-card-title>
          <app-card-description>Last 30 days</app-card-description>
        </app-card-header>
        <app-card-content>12,450 bu</app-card-content>
        <app-card-footer>Updated today</app-card-footer>
      </app-card>`,
      { imports: CARD_PARTS },
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Bushels delivered' })).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('12,450 bu')).toBeInTheDocument();
    expect(screen.getByText('Updated today')).toBeInTheDocument();
  });

  it('should render with only a content section when the header and footer are omitted', async () => {
    await render(`<app-card><app-card-content>Just content</app-card-content></app-card>`, {
      imports: [CardComponent, CardContentComponent],
    });

    expect(screen.getByText('Just content')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('should render the description as a paragraph so screen readers get a text block', async () => {
    await render(`<app-card-description>Last 30 days</app-card-description>`, {
      imports: [CardDescriptionComponent],
    });

    expect(screen.getByText('Last 30 days').tagName).toBe('P');
  });

  it('should append caller classes to the card wrapper', () => {
    const fixture = TestBed.createComponent(CardComponent);
    fixture.componentRef.setInput('class', 'producer-card');
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains('producer-card')).toBe(true);
  });

  it('should append caller classes on every section wrapper', () => {
    const sections = [
      CardHeaderComponent,
      CardTitleComponent,
      CardDescriptionComponent,
      CardContentComponent,
      CardFooterComponent,
    ];

    for (const section of sections) {
      const fixture = TestBed.createComponent(section);
      fixture.componentRef.setInput('class', 'section-extra');
      fixture.detectChanges();

      const wrapper = fixture.nativeElement.firstElementChild as HTMLElement;
      expect(wrapper.classList.contains('section-extra'), section.name).toBe(true);
      fixture.destroy();
    }
  });

  it('should render cleanly with no caller class', () => {
    const fixture = TestBed.createComponent(CardComponent);
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.firstElementChild as HTMLElement;
    // No trailing junk class from concatenating an empty input.
    expect(wrapper.className.trim().split(/\s+/).every(c => c.length > 0)).toBe(true);
    expect(wrapper.classList.contains('undefined')).toBe(false);
  });
});
