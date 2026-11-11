import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProducerInsightsToggleComponent } from './producer-insights-toggle.component';
import { ProducerInsightsPanels } from './producer-insights-panels.state';

describe('ProducerInsightsToggleComponent', () => {
  let fixture: ComponentFixture<ProducerInsightsToggleComponent>;
  let panels: ProducerInsightsPanels;

  const button = () => (fixture.nativeElement as HTMLElement).querySelector('button')!;

  beforeEach(() => {
    fixture = TestBed.createComponent(ProducerInsightsToggleComponent);
    panels = TestBed.inject(ProducerInsightsPanels);
    fixture.detectChanges();
  });

  it('opens and closes the Producer Insights panels, and shows when they are open', () => {
    expect(button().textContent).toContain('Producer Insights');
    expect(button().className).not.toContain('bg-scoular-green-accessible');

    button().click();
    fixture.detectChanges();
    expect(panels.open()).toBe(true);
    expect(button().className).toContain('bg-scoular-green-accessible');

    button().click();
    fixture.detectChanges();
    expect(panels.open()).toBe(false);
  });

  it('closes the panels when the profile, and the button with it, goes', () => {
    button().click();
    expect(panels.open()).toBe(true);

    fixture.destroy();

    expect(panels.open()).toBe(false);
  });
});
