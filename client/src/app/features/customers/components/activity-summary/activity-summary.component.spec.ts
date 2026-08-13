import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { ActivitySummaryComponent } from './activity-summary.component';
import { AppStateService } from '@core/services/app-state.service';
import { Customer } from '@models';

/**
 * The summary is open by default, and collapsing it has to STICK — including when the user moves to
 * another producer, which tears this component down and builds a new one. That's why the preference
 * lives in localStorage rather than in a component field.
 */
const KEY = 'origination.activitySummary.collapsed';

function makeCustomer(id: number): Customer {
  return { id, name: 'Test Farm' } as Customer;
}

function createComponent(): { component: ActivitySummaryComponent; ref: ComponentRef<ActivitySummaryComponent> } {
  const fixture = TestBed.createComponent(ActivitySummaryComponent);
  const ref = fixture.componentRef;
  ref.setInput('customer', makeCustomer(1));
  fixture.detectChanges();
  return { component: fixture.componentInstance, ref };
}

describe('ActivitySummaryComponent — collapsible', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AppStateService, useValue: { harvestWindows: () => [], commodityConversions: () => [] } }],
    });
    // happy-dom + JIT can't fetch templateUrl; the toggle logic is class-level.
    TestBed.overrideComponent(ActivitySummaryComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
  });

  it('is open by default', () => {
    const { component } = createComponent();
    expect(component.expanded()).toBe(true);
  });

  it('collapses and re-opens on toggle', () => {
    const { component } = createComponent();

    component.toggle();
    expect(component.expanded()).toBe(false);

    component.toggle();
    expect(component.expanded()).toBe(true);
  });

  it('stays collapsed when the user switches producers', () => {
    const first = createComponent();
    first.component.toggle();
    expect(first.component.expanded()).toBe(false);

    // Selecting another producer rebuilds the profile, so a fresh instance is constructed.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AppStateService, useValue: { harvestWindows: () => [], commodityConversions: () => [] } }],
    });
    TestBed.overrideComponent(ActivitySummaryComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const second = createComponent();

    expect(second.component.expanded()).toBe(false);
  });

  it('re-opens for the next producer once the user expands it again', () => {
    localStorage.setItem(KEY, 'true');
    const first = createComponent();
    expect(first.component.expanded()).toBe(false);

    first.component.toggle();   // back open — the collapse preference is cleared

    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('defaults to open when the stored value is missing or unrecognised', () => {
    localStorage.setItem(KEY, 'not-a-boolean');
    expect(createComponent().component.expanded()).toBe(true);
  });
});
