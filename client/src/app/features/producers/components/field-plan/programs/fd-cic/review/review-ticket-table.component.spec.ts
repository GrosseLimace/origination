import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FieldTicket } from '../../../../../models/field-plan.model';
import { ReviewTicketTableComponent } from './review-ticket-table.component';

const ticket = (over: Partial<FieldTicket> & Pick<FieldTicket, 'ticketKey'>): FieldTicket => ({
  ticketNumber: over.ticketKey, customerCode: 'TATOBIN', blDate: '2026-10-05', location: 'Pratt, KS (PRA)', productCode: 'YC',
  contractNumber: 'C1001', cropYearMatch: 'contract', netBushels: 12_000, settled: false, settledDate: null, status: null, ...over,
});

/** One matched by contract, one by BL date with nothing known about it, and one added from outside the crop year. */
const ROWS: FieldTicket[] = [
  ticket({ ticketKey: 'P1', settled: true, settledDate: '2026-11-01' }),
  ticket({ ticketKey: 'P2', customerCode: null, blDate: '2026-10-06', location: null, contractNumber: null, cropYearMatch: 'window', netBushels: null }),
  ticket({ ticketKey: 'E1', blDate: '2026-07-28', cropYearMatch: 'other', note: 'BL date outside 8/1/26–7/31/27', netBushels: 6_000 }),
];

describe('ReviewTicketTableComponent', () => {
  let fixture: ComponentFixture<ReviewTicketTableComponent>;
  let table: ReviewTicketTableComponent;

  const norm = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim() ?? '';
  const el = () => fixture.nativeElement as HTMLElement;
  const bodyRows = () => [...el().querySelectorAll('tbody tr')] as HTMLTableRowElement[];
  const cells = (tr: Element) => [...tr.querySelectorAll('td')].map(td => norm(td.textContent));
  const footer = () => cells(el().querySelector('tfoot tr')!);

  beforeEach(() => {
    fixture = TestBed.createComponent(ReviewTicketTableComponent);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.componentRef.setInput('bushels', 18_000);
    fixture.detectChanges();
    table = fixture.componentInstance;
  });

  it('should list each ticket with its customer, BL date, location, contract and bushels, a dash or ? for what isn\'t known', () => {
    expect(bodyRows().map(cells)).toEqual([
      ['P1', 'TATOBIN', '10/05/26', 'Pratt, KS (PRA)', 'C1001 contract yr', '12,000', 'Settled 11/01'],
      ['P2', '—', '10/06/26', '—', '— date', '?', 'Open'],
      ['E1', 'TATOBIN', '07/28/26', 'Pratt, KS (PRA)', 'C1001 added', '6,000', 'Open'],
    ]);
  });

  it('should say how each ticket got in the crop year when hovered, with the originator\'s note on an added one', () => {
    const tags = bodyRows().map(tr => tr.querySelector('td span')!);

    expect(tags.map(t => t.getAttribute('title'))).toEqual([
      'Matched by the contract\'s crop year',
      'Matched by its BL date in the crop year window',
      'Added by the originator: bl date outside 8/1/26–7/31/27',
    ]);
    expect(tags.map(t => t.className.includes('bg-amber-100'))).toEqual([false, false, true]);
  });

  it('should count the tickets and total the bushels in the footer, with no include boxes when not picking', () => {
    expect(footer()).toEqual(['3 tickets', '18,000', '']);
    expect(el().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(el().querySelector('button')).toBeNull();

    fixture.componentRef.setInput('rows', ROWS.slice(0, 1));
    fixture.detectChanges();
    expect(footer()[0]).toBe('1 ticket');
  });

  describe('when picking', () => {
    let toggled: string[];
    let toggledAll: number;
    let removed: string[];

    beforeEach(() => {
      fixture.componentRef.setInput('pick', true);
      fixture.componentRef.setInput('excluded', new Set(['P2']));
      fixture.componentRef.setInput('includedCount', 2);
      fixture.componentRef.setInput('someIncluded', true);
      fixture.detectChanges();
      toggled = [];
      toggledAll = 0;
      removed = [];
      table.toggle.subscribe(k => toggled.push(k));
      table.toggleAll.subscribe(() => toggledAll++);
      table.removeAdded.subscribe(k => removed.push(k));
    });

    const rowBox = (i: number) => bodyRows()[i].querySelector('input[type="checkbox"]') as HTMLInputElement;
    const headerBox = () => el().querySelector('thead input[type="checkbox"]') as HTMLInputElement;

    it('should tick the included tickets, dim the left-out ones, and say how many are included', () => {
      expect([0, 1, 2].map(i => rowBox(i).checked)).toEqual([true, false, true]);
      expect(bodyRows().map(tr => tr.classList.contains('opacity-40'))).toEqual([false, true, false]);
      expect(rowBox(1).getAttribute('aria-label')).toBe('Include ticket P2');
      expect(rowBox(0).getAttribute('aria-label')).toBe('Include ticket P1 for TATOBIN');
      expect(headerBox().indeterminate).toBe(true);
      expect(footer()).toEqual(['', '2 of 3 included', '18,000', '']);
    });

    it('should hand ticking, ticking every ticket, and removing an added ticket to the parent', () => {
      rowBox(1).dispatchEvent(new Event('change'));
      headerBox().dispatchEvent(new Event('change'));
      const removeLinks = el().querySelectorAll('tbody button');
      expect(removeLinks).toHaveLength(1);
      expect(removeLinks[0].getAttribute('aria-label')).toBe('Remove added ticket E1');
      (removeLinks[0] as HTMLButtonElement).click();

      expect(toggled).toEqual(['P2']);
      expect(toggledAll).toBe(1);
      expect(removed).toEqual(['E1']);
    });

    it('should disable the header box when no ticket can be counted', () => {
      expect(headerBox().disabled).toBe(false);
      fixture.componentRef.setInput('anyCountable', false);
      fixture.detectChanges();
      expect(headerBox().disabled).toBe(true);
    });
  });
});
