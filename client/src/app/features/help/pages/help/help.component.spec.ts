import { describe, it, expect, vi } from 'vitest';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { render, screen, fireEvent } from '@testing-library/angular';
import type { HelpContent } from '@models';
import { HelpComponent } from './help.component';
import { HelpService } from '@core/services/help.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { provideTestEnvironment } from '@testing/test-providers';

const content: HelpContent = {
  categories: [
    { id: 'build', name: 'Build a List', icon: 'list', faqIds: ['build-list'] },
    { id: 'dash', name: 'Planting dashboard', icon: 'bar-chart', faqIds: ['season-targets'] }
  ],
  suggestions: { '*': ['build-list'] },
  faqs: [
    { id: 'build-list', question: 'How do I build a list?', keywords: ['build'], routes: [], feature: 'build-a-list', answer: 'Open **Build a List**.', related: [], uiLabels: [], lastVerified: '2026-10-13' },
    { id: 'season-targets', question: 'How do I set season targets?', keywords: ['season', 'targets'], routes: [], feature: 'dashboard', answer: 'Use **Set Season Targets**.', related: [], uiLabels: [], lastVerified: '2026-10-13' }
  ]
};

async function renderPage() {
  const faqs = content.faqs;
  return render(HelpComponent, {
    providers: provideTestEnvironment({
      extraProviders: [
        { provide: HelpService, useValue: { content: signal(content), failed: signal(false), faqs: signal(faqs), faq: (id: string) => faqs.find(f => f.id === id), load: vi.fn().mockResolvedValue(undefined) } },
        { provide: UsageTrackingService, useValue: { trackHelpOpened: vi.fn(), trackHelpAnswer: vi.fn() } }
      ]
    })
  });
}

describe('HelpComponent', () => {
  it('shows a tile per category and every question under it', async () => {
    await renderPage();

    expect(screen.getByRole('button', { name: /Build a List 1 question/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How do I build a list?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How do I set season targets?' })).toBeTruthy();
  });

  it('filters to one category when its tile is chosen', async () => {
    const { fixture } = await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Planting dashboard/ }));
    fixture.detectChanges();

    expect(screen.queryByRole('button', { name: 'How do I build a list?' })).toBeNull();
    expect(screen.getByRole('button', { name: 'How do I set season targets?' })).toBeTruthy();
  });

  it('scrolls the chosen topic\'s questions into view, since they sit below the tiles', async () => {
    const scrolled: Element[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this); });
    const { fixture } = await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Planting dashboard/ }));
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(scrolled.map(e => e.id)).toContain('help-cat-dash');
    spy.mockRestore();
  });

  it('scrolls an opened answer into view', async () => {
    const scrolled: Element[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this); });
    const { fixture } = await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'How do I build a list?' }));
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(scrolled.map(e => e.id)).toContain('help-q-build-list');
    spy.mockRestore();
  });

  it('expands an answer', async () => {
    const { fixture } = await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'How do I build a list?' }));
    fixture.detectChanges();

    expect(screen.getByText('Build a List', { selector: 'strong' })).toBeTruthy();
  });

  it('offers the Help panel when a search finds nothing', async () => {
    const { fixture } = await renderPage();

    fireEvent.input(screen.getByLabelText('Search help'), { target: { value: 'freight rates' } });
    fixture.detectChanges();

    expect(screen.getByText('No help topics match "freight rates"')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask in the Help panel' })).toBeTruthy();
  });
});
