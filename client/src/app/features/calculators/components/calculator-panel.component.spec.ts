import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input } from '@angular/core';
import { By } from '@angular/platform-browser';
import { Customer } from '@models';
import { CustomerScreenSources, customerScreenSources } from '@testing/customer-screen-sources';
import { CalculatorPanelComponent } from './calculator-panel.component';
import { CalculatorLauncherComponent } from './calculator-launcher.component';

/** The launcher has its own spec; this stands in for it so the panel's own rules are what's tested. */
@Component({ selector: 'app-calculator-launcher', standalone: true, template: '' })
class StubLauncher {
  readonly producerName = input<string>('');
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: '', location: '', phone: '', email: '', totalAcres: 0,
    linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

describe('CalculatorPanelComponent', () => {
  let fixture: ComponentFixture<CalculatorPanelComponent>;
  let sources: CustomerScreenSources;

  const launcher = (): StubLauncher | null =>
    fixture.debugElement.query(By.directive(StubLauncher))?.componentInstance ?? null;

  beforeEach(async () => {
    sources = customerScreenSources();
    TestBed.overrideComponent(CalculatorPanelComponent, {
      remove: { imports: [CalculatorLauncherComponent] },
      add: { imports: [StubLauncher] },
    });
    await TestBed.configureTestingModule({ imports: [CalculatorPanelComponent], providers: sources.providers }).compileComponents();
    fixture = TestBed.createComponent(CalculatorPanelComponent);
  });

  it('shows the launcher while a producer is selected, with their name to prefill', () => {
    fixture.detectChanges();
    expect(launcher()).toBeNull();

    sources.customer.set(makeCustomer({ name: 'Smith Farms' }));
    fixture.detectChanges();
    expect(launcher()?.producerName()).toBe('Smith Farms');

    sources.customer.set(makeCustomer({ id: 7, name: 'Other Farm' }));
    fixture.detectChanges();
    expect(launcher()?.producerName()).toBe('Other Farm');
  });

  // Back to the list, the launcher goes, and any calculator open in it; the next producer starts fresh.
  it('takes the launcher away when no producer is selected', () => {
    sources.customer.set(makeCustomer());
    fixture.detectChanges();
    const first = launcher();

    sources.customer.set(null);
    fixture.detectChanges();
    expect(launcher()).toBeNull();

    sources.customer.set(makeCustomer());
    fixture.detectChanges();
    expect(launcher()).not.toBe(first);
  });

  it('takes no space of its own', () => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).classList).toContain('contents');
  });
});
