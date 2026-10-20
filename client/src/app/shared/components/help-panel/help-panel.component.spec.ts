import { describe, it, expect, vi } from 'vitest';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { render, screen, fireEvent } from '@testing-library/angular';
import type { HelpContent } from '@models';
import { HelpPanelComponent } from './help-panel.component';
import { HelpPanelService } from '@core/services/help-panel.service';
import { HelpService } from '@core/services/help.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { provideTestEnvironment } from '@testing/test-providers';

const content: HelpContent = {
  categories: [{ id: 'build', name: 'Build a List', icon: 'list', faqIds: ['build-list', 'saved-list-missing'] }],
  suggestions: { '/': ['build-list'], '*': ['saved-list-missing'] },
  faqs: [
    {
      id: 'build-list', question: 'How do I build a list?', keywords: ['build', 'list'], routes: [], feature: 'build-a-list',
      answer: 'Open **Build a List** and pick a query.', steps: ['Open **Build a List**.'], related: ['saved-list-missing'],
      uiLabels: [], lastVerified: '2026-10-13'
    },
    {
      id: 'saved-list-missing', question: "Why isn't my saved list in the dropdown?", chip: 'Saved list not in dropdown',
      keywords: ['saved', 'dropdown'], routes: [], feature: 'build-a-list', answer: 'Select one of its trade units.', related: [],
      uiLabels: [], lastVerified: '2026-10-13'
    }
  ]
};

async function renderPanel() {
  const helpStub = {
    content: signal(content),
    failed: signal(false),
    faqs: signal(content.faqs),
    faq: (id: string) => content.faqs.find(f => f.id === id),
    suggestionsFor: (route: string) => (content.suggestions[route] ?? content.suggestions['*']).map(id => content.faqs.find(f => f.id === id)!),
    load: vi.fn().mockResolvedValue(undefined)
  };
  const result = await render(HelpPanelComponent, {
    providers: provideTestEnvironment({
      extraProviders: [
        { provide: HelpService, useValue: helpStub },
        { provide: UsageTrackingService, useValue: { trackHelpOpened: vi.fn(), trackHelpAnswer: vi.fn(), trackHelpNoMatch: vi.fn(), trackHelpFeedback: vi.fn() } }
      ]
    })
  });
  const panel = result.fixture.debugElement.injector.get(HelpPanelService);
  panel.openPanel('header');
  result.fixture.detectChanges();
  return { ...result, panel };
}

describe('HelpPanelComponent', () => {
  it('greets and suggests questions for the current page', async () => {
    await renderPanel();

    expect(screen.getByRole('dialog', { name: 'Help' })).toBeTruthy();
    expect(screen.getByText('Hi! What can I help with?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How do I build a list?' })).toBeTruthy();
  });

  it('answers a typed question with the layered card', async () => {
    const { fixture } = await renderPanel();

    fireEvent.input(screen.getByLabelText('Ask a question'), { target: { value: 'build a list' } });
    fireEvent.submit(screen.getByLabelText('Ask a question').closest('form')!);
    fixture.detectChanges();

    expect(screen.getByRole('heading', { name: 'How do I build a list?' })).toBeTruthy();
    // Bold markers become bold text, never markup.
    expect(screen.getByText('Build a List', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show steps' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Saved list not in dropdown' })).toBeTruthy();
  });

  it('scrolls expanded steps into view, so the change is not missed below the fold', async () => {
    const scrolled: Element[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this); });
    const { fixture, panel } = await renderPanel();

    panel.askFaq('build-list');
    fixture.detectChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Show steps' }));
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();

    expect(scrolled.some(e => e.id.endsWith('-steps'))).toBe(true);
    spy.mockRestore();
  });

  it('falls back to browse and report when nothing matches', async () => {
    const { fixture, panel } = await renderPanel();

    panel.ask('weather in Omaha');
    fixture.detectChanges();

    expect(screen.getByText("I couldn't find an answer to that.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeTruthy();
  });

  it('thanks the user and offers to report after a thumbs down', async () => {
    const { fixture, panel } = await renderPanel();

    panel.askFaq('build-list');
    fixture.detectChanges();
    fireEvent.click(screen.getByRole('button', { name: "No, this wasn't helpful" }));
    fixture.detectChanges();

    expect(screen.getByText(/we'll use that to improve this answer/)).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const { fixture, panel } = await renderPanel();

    fireEvent.keyDown(document, { key: 'Escape' });
    fixture.detectChanges();

    expect(panel.open()).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  });
});
