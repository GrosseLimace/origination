import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HelpPanelStateService } from './help-panel-state.service';

describe('HelpPanelStateService', () => {
  let state: HelpPanelStateService;

  beforeEach(() => {
    // No providers on purpose: the shell, header and Calculators button inject this, so it must
    // construct without the router, MSAL or any data service.
    TestBed.resetTestingModule();
    state = TestBed.inject(HelpPanelStateService);
    state.desktop.set(true);
  });

  it('starts closed and takes no room', () => {
    expect(state.open()).toBe(false);
    expect(state.pushesPage()).toBe(false);
  });

  it('makes room beside the page when open on desktop', () => {
    state.open.set(true);
    expect(state.pushesPage()).toBe(true);
  });

  it('gives the room back while a spotlight is showing', () => {
    state.open.set(true);
    state.spotlight.set('trade-unit-selector');
    expect(state.pushesPage()).toBe(false);
  });

  it('never pushes the page on a phone, where the panel covers it', () => {
    state.open.set(true);
    state.desktop.set(false);
    expect(state.pushesPage()).toBe(false);
  });
});
