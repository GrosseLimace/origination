import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import type { HelpFaq } from '@models';
import { HelpPanelService } from './help-panel.service';
import { HelpService } from './help.service';
import { UsageTrackingService } from './usage-tracking.service';
import { UserTradeUnitsService } from './user-trade-units.service';
import { AppStateService } from './app-state.service';

function faq(id: string, question: string, keywords: string[]): HelpFaq {
  return { id, question, keywords, routes: [], answer: 'A.', feature: 'system', related: [], uiLabels: [], lastVerified: '2026-10-13' };
}

const faqs = [
  faq('build-list', 'How do I build a list?', ['build', 'list']),
  faq('tu-a', 'What is a trade unit?', ['trade', 'unit']),
  faq('tu-b', 'How do I set up trade units?', ['trade', 'unit'])
];

describe('HelpPanelService', () => {
  let service: HelpPanelService;
  let tracking: Record<string, ReturnType<typeof vi.fn>>;
  let openPreferences: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tracking = {
      trackHelpOpened: vi.fn(),
      trackHelpAnswer: vi.fn(),
      trackHelpNoMatch: vi.fn(),
      trackHelpFeedback: vi.fn()
    };
    openPreferences = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        AppStateService,
        {
          provide: HelpService,
          useValue: { faqs: signal(faqs), faq: (id: string) => faqs.find(f => f.id === id), load: vi.fn().mockResolvedValue(undefined) }
        },
        { provide: UsageTrackingService, useValue: tracking },
        { provide: UserTradeUnitsService, useValue: { openPreferences } }
      ]
    });
    service = TestBed.inject(HelpPanelService);
  });

  it('opens, records where from, and closes on a second toggle', () => {
    service.toggle('header');
    expect(service.open()).toBe(true);
    expect(tracking['trackHelpOpened']).toHaveBeenCalledWith('header');

    service.toggle('header');
    expect(service.open()).toBe(false);
  });

  it('answers a clear match and records the FAQ id', () => {
    service.ask('how do I build a list');

    expect(service.thread()).toEqual([
      { kind: 'user', text: 'how do I build a list' },
      { kind: 'answer', faqId: 'build-list', feedback: null }
    ]);
    expect(tracking['trackHelpAnswer']).toHaveBeenCalledWith('build-list');
  });

  it('offers "did you mean" on a tie', () => {
    service.ask('trade unit');
    expect(service.thread()[1]).toEqual({ kind: 'did-you-mean', faqIds: ['tu-a', 'tu-b'] });
  });

  it('records an unanswered question so the FAQ can grow from it', () => {
    service.ask('weather in Omaha');

    expect(service.thread()[1]).toEqual({ kind: 'no-match' });
    expect(tracking['trackHelpNoMatch']).toHaveBeenCalledWith('weather in Omaha');
  });

  it('ignores a blank question', () => {
    service.ask('   ');
    expect(service.thread()).toEqual([]);
  });

  it('takes feedback once per answer', () => {
    service.askFaq('build-list');
    service.setFeedback(1, false);
    service.setFeedback(1, true);

    expect(service.thread()[1]).toEqual({ kind: 'answer', faqId: 'build-list', feedback: 'down' });
    expect(tracking['trackHelpFeedback']).toHaveBeenCalledTimes(1);
    expect(tracking['trackHelpFeedback']).toHaveBeenCalledWith('build-list', false);
  });

  it('runs a route action as in-app navigation', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    service.run({ kind: 'route', label: 'Take me there', target: '/build-list' });
    expect(navigate).toHaveBeenCalledWith('/build-list');
  });

  it('opens Trade Unit Preferences for a tup action', () => {
    service.run({ kind: 'tup', label: 'Open Trade Unit Preferences' });
    expect(openPreferences).toHaveBeenCalled();
  });

  it('steps the panel aside while a spotlight is showing', () => {
    service.openPanel('header');
    service.showOnScreen('trade-unit-selector');
    expect(service.spotlight()).toBe('trade-unit-selector');
    expect(service.pushesPage()).toBe(false);

    service.endSpotlight();
    expect(service.spotlight()).toBeNull();
  });

  it('replaces the previous answer when a new question is asked, instead of stacking it below', () => {
    service.askFaq('build-list');
    const turn = service.turn();
    service.askFaq('tu-a');

    expect(service.thread()).toEqual([
      { kind: 'user', text: 'What is a trade unit?' },
      { kind: 'answer', faqId: 'tu-a', feedback: null }
    ]);
    expect(service.turn()).toBe(turn + 1);
  });

  it('adds follow-on steps below the current answer, once each', () => {
    service.askFaq('build-list');
    service.escalate();
    service.escalate();
    service.startTroubleshooter('missing-producer');

    expect(service.thread().map(t => t.kind)).toEqual(['user', 'answer', 'escalation', 'troubleshooter']);
  });

  it('remembers the question and every answer read, for the help desk ticket', () => {
    service.ask('weather in Omaha');
    service.askFaq('build-list');
    service.askFaq('tu-a');

    expect(service.lastQuestion()).toBe('What is a trade unit?');
    expect(service.viewedFaqIds()).toEqual(['build-list', 'tu-a']);
  });

  it('starts over on reset', () => {
    service.askFaq('build-list');
    service.reset();
    expect(service.thread()).toEqual([]);
  });
});
