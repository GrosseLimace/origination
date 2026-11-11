import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Contract, Customer, HarvestWindow } from '@models';
import { AppStateService } from '@core/services/app-state.service';
import { ContractPaceComponent, harvestPace } from './contract-pace.component';
import { ProducerInsightsPanels } from '../producer-insights/producer-insights-panels.state';
import { CustomerScreenSources, customerScreenSources } from '@testing/customer-screen-sources';
import { ContractPacingHistoryFake, contractPacingHistoryFake, provideContractPacingHistory } from '../../data-access/contract-pacing-history.store.testing';

const YEAR = 2026;
const corn: HarvestWindow = { id: 1, commodity: 'Corn', deliveryStartMonth: 9, deliveryStartDay: 1, deliveryEndMonth: 11, deliveryEndDay: 30, isActive: true };
const soybeans: HarvestWindow = { ...corn, id: 2, commodity: 'Soybeans' };
/** Noon local time on a calendar date (1-based month). */
const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12);
/** A corn contract delivering in October of the given year. */
const contract = (id: number, year: number, quantity: number, over: Partial<Contract> = {}) =>
  ({ id, commodityGroup: 'Corn', quantity, deliveryStart: day(year, 10, 1), deliveryEnd: day(year, 10, 31), ...over }) as Contract;

describe('harvestPace: which way the harvest contracting is heading', () => {
  it('is up when a commodity has more in this year\'s window than last, and none has less', () => {
    expect(harvestPace([contract(1, YEAR, 5000), contract(2, YEAR - 1, 3000)], [corn], YEAR)).toBe('up');
  });

  it('is down when ANY commodity is behind last year, whatever the others do', () => {
    const contracts = [
      contract(1, YEAR, 5000), contract(2, YEAR - 1, 3000),
      contract(3, YEAR, 100, { commodityGroup: 'Soybeans' }), contract(4, YEAR - 1, 900, { commodityGroup: 'Soybeans' }),
    ];
    expect(harvestPace(contracts, [corn, soybeans], YEAR)).toBe('down');
  });

  it('is flat when there is data but no movement', () => {
    expect(harvestPace([contract(1, YEAR, 1000), contract(2, YEAR - 1, 1000)], [corn], YEAR)).toBe('flat');
  });

  it('is none without contracts, without active windows, or with nothing in any window', () => {
    expect(harvestPace([], [corn], YEAR)).toBe('none');
    expect(harvestPace([contract(1, YEAR, 1000)], [{ ...corn, isActive: false }], YEAR)).toBe('none');
    expect(harvestPace([contract(1, YEAR, 1000, { deliveryStart: day(YEAR, 3, 1), deliveryEnd: day(YEAR, 3, 31) })], [corn], YEAR)).toBe('none');
  });
});

describe('ContractPaceComponent', () => {
  let fixture: ComponentFixture<ContractPaceComponent>;
  let sources: CustomerScreenSources;
  let pacing: ContractPacingHistoryFake;
  let state: AppStateService;

  const text = () => ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  const box = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[title*="Harvest Contract Pace details"]');

  beforeEach(() => {
    sources = customerScreenSources();
    pacing = contractPacingHistoryFake();
    TestBed.configureTestingModule({ providers: [...sources.providers, provideContractPacingHistory(pacing)] });
    state = TestBed.inject(AppStateService);
    sources.customer.set({ id: 42, name: 'Sample Farms' } as Customer);
    fixture = TestBed.createComponent(ContractPaceComponent);
  });

  // A failed background load used to leave the box reading as genuinely empty.
  it('says the harvest windows could not be loaded instead of "No contract data available"', () => {
    state.setHarvestWindowsLoadFailed(true);
    fixture.detectChanges();

    expect(text()).toContain("Harvest windows couldn't be loaded — pace cannot be shown.");
    expect(text()).not.toContain('No contract data available.');
  });

  it('still says "No contract data available" when nothing failed', () => {
    fixture.detectChanges();

    expect(text()).toContain('No contract data available.');
    expect(text()).not.toContain("Harvest windows couldn't be loaded");
  });

  it('shows the pace as normal once harvest windows are present, whatever the flag says', () => {
    state.setHarvestWindowsLoadFailed(true);
    state.setHarvestWindows([{ id: 1, commodity: 'CORN', deliveryStartMonth: 1, deliveryStartDay: 1, deliveryEndMonth: 12, deliveryEndDay: 31 } as HarvestWindow]);
    const year = new Date().getFullYear();
    sources.activity.contracts.set([{ id: 7, commodityGroup: 'CORN', quantity: 1000, deliveryStart: day(year, 6, 1), deliveryEnd: day(year, 6, 30) } as Contract]);
    fixture.detectChanges();

    expect(text()).not.toContain("Harvest windows couldn't be loaded");
    expect(text()).not.toContain('No contract data available.');
    expect(text()).toContain(`${year - 1} vs ${year}`);
    expect(box()!.textContent).toContain('▲');
  });

  // Pace compares this year against last, so with either read missing "no contract data" would read as a producer
  // who has contracted nothing.
  it("says contract data is unavailable when the producer's contracts, or their history, could not be read", () => {
    sources.activity.contractsLoadError.set('CTRM is not answering.');
    fixture.detectChanges();
    expect(text()).toContain('Contract data unavailable — pace cannot be shown.');

    sources.activity.contractsLoadError.set(null);
    pacing.failed.set(true);
    fixture.detectChanges();
    expect(text()).toContain('Contract data unavailable — pace cannot be shown.');
  });

  it("asks for the producer's pacing history, which every pacing figure shares", () => {
    fixture.detectChanges();
    expect(pacing.load).toHaveBeenLastCalledWith(42);
  });

  it('opens and closes the Producer Insights panels, as their button does', () => {
    state.setHarvestWindows([{ id: 1, commodity: 'CORN', deliveryStartMonth: 1, deliveryStartDay: 1, deliveryEndMonth: 12, deliveryEndDay: 31 } as HarvestWindow]);
    const year = new Date().getFullYear();
    sources.activity.contracts.set([{ id: 7, commodityGroup: 'CORN', quantity: 1000, deliveryStart: day(year, 6, 1), deliveryEnd: day(year, 6, 30) } as Contract]);
    fixture.detectChanges();
    const panels = TestBed.inject(ProducerInsightsPanels);
    expect(box()!.title).toBe('Click to show Harvest Contract Pace details');

    box()!.click();
    fixture.detectChanges();
    expect(panels.open()).toBe(true);
    expect(box()!.title).toBe('Click to hide Harvest Contract Pace details');

    box()!.click();
    expect(panels.open()).toBe(false);
  });
});
