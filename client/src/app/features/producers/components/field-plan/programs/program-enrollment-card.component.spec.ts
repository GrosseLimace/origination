import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Type, WritableSignal } from '@angular/core';
import { FieldProgramRecord, FieldTicket, OfficialResult } from '../../../models/field-plan.model';
import { downloadCsv } from '@shared/utils/csv';
import { FieldPlanStore } from '../store/field-plan.store';
import { ProgramIntake, SustainabilityProgramDef } from './program-def';
import { SUSTAINABILITY_PROGRAMS } from './program-registry';
import { ProgramEnrollmentCardComponent } from './program-enrollment-card.component';

vi.mock('@shared/utils/csv', async importOriginal => ({
  ...(await importOriginal<typeof import('@shared/utils/csv')>()),
  downloadCsv: vi.fn(),
}));

/**
 * A made-up program that gives its fields IDs and scores them, so the card's grouping can be checked against
 * CIs and bushels chosen here rather than the USDA arithmetic. Grouped by crop row, as 45Z groups by crop.
 */
interface CiData { ci: number | null; bushels: number | null; projected: boolean }
const CI_PROGRAM: SustainabilityProgramDef<CiData> = {
  key: 'ci-test',
  label: 'CI test program',
  shortLabel: 'CI test',
  description: 'Test program',
  appliesTo: () => true,
  blankData: () => ({ ci: null, bushels: null, projected: true }),
  copyForward: () => null,
  missing: d => (d.ci === null ? ['CI'] : []),
  preview: d => (d.ci === null ? null : { value: d.ci, unit: 'g CO2e/bu', unitShort: 'g/bu' }),
  previewNote: d => (d.ci === null ? 'calculating…' : null),
  freeze: d => ({ inputs: { ...d }, outputs: {}, calculatorVersion: 'ci v0' }),
  fieldResults: items => items.map(({ record, season }) => ({
    recordId: record.id, group: season.cropLabel, value: record.data.ci, unitShort: 'g/bu',
    bushels: record.data.bushels, projected: record.data.projected,
  })),
  intake: class {} as unknown as Type<ProgramIntake>,
  official: { resultName: 'CI', requirementsNote: 'Confirm each field after harvest.' },
  enrollment: { idPrefix: 'CI' },
};

/** A program that records field data only, with no IDs: the card has nothing to show for it. */
const NO_ID_PROGRAM: SustainabilityProgramDef<CiData> = { ...CI_PROGRAM, key: 'no-id-test', shortLabel: 'No ID', enrollment: undefined };

const producer = { code: 'TATOBIN', name: 'T-A TOBIN FARMS LC' };

const ticket = (n: number, netBushels: number): FieldTicket => ({
  ticketKey: `k${n}`, ticketNumber: `P${n}`, blDate: '2026-10-05', location: null, productCode: 'YC',
  contractNumber: null, cropYearMatch: 'window', netBushels, settled: false, settledDate: null, status: null,
});

describe('ProgramEnrollmentCardComponent (the per-producer program card)', () => {
  let store: FieldPlanStore;
  let fixture: ComponentFixture<ProgramEnrollmentCardComponent>;
  let card: ProgramEnrollmentCardComponent;
  /** Record IDs by field name. */
  const ids: Record<string, string> = {};

  /** Puts one of a producer's splits in a program for a crop year, with its CI and bushels. */
  async function enroll(name: string, splitId: string, cropLabel: string, data: CiData, opts: { customerId?: number; year?: number; programKey?: string } = {}) {
    const field = (await store.createField({ splitId, customerId: opts.customerId ?? 9, name, splitPercent: 100, effectiveDate: '2018-10-01', state: 'KS', county: 'Pratt' }))!;
    const season = (await store.addSeason(field.fieldKey, 1, opts.year ?? 2026, cropLabel, 80))!;
    const record = (await store.addRecord(season.id, opts.programKey ?? CI_PROGRAM.key))!;
    store.updateRecord(record.id, data);
    ids[name] = record.id;
  }

  /** As a review would leave it: locked with a confirmed CI and its tickets. */
  function confirm(name: string, ci: number, tickets: FieldTicket[]): void {
    const official: OfficialResult = {
      status: 'Documented', score: { value: ci, unit: 'g CO2e/bu', unitShort: 'g/bu' }, method: 'ci v0',
      bushels: tickets.reduce((sum, t) => sum + (t.netBushels ?? 0), 0), tickets,
      documentedBy: 'tess.tester@example.test', documentedAt: '2026-11-03T15:00:00Z',
    };
    // The store only exposes readonly views, and the in-memory confirm() accepts the real 45Z program only,
    // so the test writes the result into the store's private records directly.
    (store as unknown as { _records: WritableSignal<FieldProgramRecord[]> })._records
      .update(rs => rs.map(r => (r.id === ids[name] ? { ...r, status: 'Locked', official } : r)));
  }

  function render(programKey = CI_PROGRAM.key, withProducer: { code: string; name: string } | null = producer): void {
    fixture = TestBed.createComponent(ProgramEnrollmentCardComponent);
    fixture.componentRef.setInput('programKey', programKey);
    fixture.componentRef.setInput('customerId', 9);
    fixture.componentRef.setInput('year', 2026);
    fixture.componentRef.setInput('producer', withProducer);
    fixture.detectChanges();
    card = fixture.componentInstance;
  }

  const norm = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim() ?? '';
  const text = () => norm((fixture.nativeElement as HTMLElement).textContent);
  /** The collapsed line's parts: arrow, program and year, field count, and so on. */
  const summaryLine = () => [...buttons()[0].children].map(e => norm(e.textContent));
  /** Each ladder row: CI, confirmed or estimate, field, ID, acres, bushels, at or below, confirmed status. */
  const ladderRows = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')].map(tr => {
    const [ci, ...rest] = [...tr.querySelectorAll('td')];
    return [...[...ci.querySelectorAll('div')].map(d => norm(d.textContent)), ...rest.map(td => norm(td.textContent))];
  });
  const buttons = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
  const expand = () => { buttons()[0].click(); fixture.detectChanges(); };
  const ledgerButton = () => buttons().find(b => b.textContent?.includes('Mass Balance Ledger'));

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: SUSTAINABILITY_PROGRAMS, useValue: [CI_PROGRAM, NO_ID_PROGRAM] }] });
    store = TestBed.inject(FieldPlanStore);
    vi.mocked(downloadCsv).mockClear();

    await enroll('NORTH', 'TATOB28', 'Corn', { ci: 2874, bushels: 44_000, projected: false });
    await enroll('SOUTH', 'TATOB29', 'Corn', { ci: 2034, bushels: 25_000, projected: true });
    await enroll('EAST 80', 'TATOB30', 'Corn', { ci: 6100, bushels: 16_000, projected: true });
    await enroll('HOME', 'TATOB31', 'Soybeans', { ci: 1500.4, bushels: null, projected: true });
    await enroll('WEST', 'TATOB32', 'Corn', { ci: null, bushels: null, projected: true });
    // Not this card's: another producer's field, last year's season, and a program without IDs.
    await enroll('NEIGHBOR', 'NEIGH01', 'Corn', { ci: 1000, bushels: 9_000, projected: false }, { customerId: 11 });
    await enroll('LAST YEAR', 'TATOB33', 'Corn', { ci: 1000, bushels: 9_000, projected: false }, { year: 2025 });
    await enroll('OTHER PROGRAM', 'TATOB34', 'Corn', { ci: 1000, bushels: 9_000, projected: false }, { programKey: NO_ID_PROGRAM.key });
  });

  afterEach(() => vi.useRealTimers());

  it('should show nothing for a program that doesn\'t give its fields IDs', () => {
    render(NO_ID_PROGRAM.key);

    expect(card.program()).toBeUndefined();
    expect(text()).toBe('');
  });

  it('should hold only the producer\'s fields in this program for this year, each with its derived ID', () => {
    render();

    expect(card.records().map(r => [r.fieldName, r.enrollmentId])).toEqual([
      ['NORTH', 'CI-2026-TATOB28'], ['SOUTH', 'CI-2026-TATOB29'], ['EAST 80', 'CI-2026-TATOB30'],
      ['HOME', 'CI-2026-TATOB31'], ['WEST', 'CI-2026-TATOB32'],
    ]);
    expect(summaryLine().slice(0, 3)).toEqual(['▸', '🌱 CI test · 2026', '5 fields']);
  });

  it('should ladder each crop\'s scored fields lowest CI first, with the bushels at or below each', () => {
    render();

    expect(card.groups().map(g => [g.group, g.ladder.map(r => [r.item.fieldName, r.atOrBelow])])).toEqual([
      ['Corn', [['SOUTH', 25_000], ['NORTH', 69_000], ['EAST 80', 85_000]]],
      ['Soybeans', [['HOME', 0]]],
    ]);
  });

  it('should sum up each crop as its CI range and total bushels, one rounded CI when it has one field', () => {
    render();

    expect(card.groups().map(g => [g.group, g.range, g.bushels])).toEqual([['Corn', '2,034–6,100', 85_000], ['Soybeans', '1,500', 0]]);
    expect(summaryLine().slice(3)).toEqual(['Corn 2,034–6,100 g/bu · 85,000 bu', 'Soybeans 1,500 g/bu · 0 bu']);
  });

  it('should list fields with no score yet apart from the ladders, saying why', () => {
    render();
    expand();

    expect(card.unscored().map(r => r.fieldName)).toEqual(['WEST']);
    const items = [...(fixture.nativeElement as HTMLElement).querySelectorAll('li')].map(li => norm(li.textContent));
    expect(items).toEqual(['WEST (CI-2026-TATOB32) · Corn · 80 ac · calculating…']);
    expect(ladderRows().map(r => r[2])).not.toContain('WEST');
  });

  it('should total the bushels and fields at or below a typed CI target, and colour each CI against it', () => {
    render();
    const corn = card.groups()[0];

    card.setTarget('Corn', '3000');
    expect(card.targetResult(corn)).toEqual({ bushels: 69_000, fields: 2 });
    expect([2034, 2874, 6100].map(v => card.targetSide('Corn', v))).toEqual(['at-or-below', 'at-or-below', 'above']);
    expect(card.targetSide('Soybeans', 1500)).toBeNull();

    expand();
    expect(text()).toContain('→ 69,000 bu from 2 fields');
  });

  it('should drop a target that is cleared, zero, negative or not a number', () => {
    render();
    const corn = card.groups()[0];

    for (const typed of ['', null, 0, -5, 'abc']) {
      card.setTarget('Corn', 3000);
      card.setTarget('Corn', typed);
      expect(card.targets()['Corn']).toBeNull();
      expect(card.targetResult(corn)).toBeNull();
    }
  });

  it('should count the confirmed fields and mark each field confirmed or still an estimate', () => {
    confirm('NORTH', 2874, [ticket(1, 44_000)]);
    render();
    expand();

    expect(card.confirmedCount()).toBe(1);
    expect(card.records().map(r => [r.fieldName, r.official])).toEqual([
      ['NORTH', 'confirmed'], ['SOUTH', 'not confirmed'], ['EAST 80', 'not confirmed'], ['HOME', 'not confirmed'], ['WEST', 'not confirmed'],
    ]);
    expect(summaryLine()).toContain('1 of 5 confirmed');
    expect(ladderRows()).toEqual([
      ['2,034', 'estimate · projected', 'SOUTH', 'CI-2026-TATOB29', '80', '25,000 projected', '25,000', 'not confirmed'],
      ['2,874', 'confirmed', 'NORTH', 'CI-2026-TATOB28', '80', '44,000', '69,000', 'confirmed'],
      ['6,100', 'estimate · projected', 'EAST 80', 'CI-2026-TATOB30', '80', '16,000 projected', '85,000', 'not confirmed'],
      ['1,500', 'estimate · projected', 'HOME', 'CI-2026-TATOB31', '80', 'no yield', '0', 'not confirmed'],
    ]);
  });

  it('should download the Mass Balance Ledger with one row per confirmed field, named by producer, year and day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 9, 30));
    confirm('NORTH', 2874.456, [ticket(1, 30_000), ticket(2, 14_000)]);
    confirm('SOUTH', 2034, [ticket(3, 25_000)]);
    render();
    expand();

    const button = ledgerButton();
    expect(button?.textContent?.trim()).toBe('Download Mass Balance Ledger · 2 fields');
    button!.click();

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [csv, fileName] = vi.mocked(downloadCsv).mock.calls[0];
    expect(fileName).toBe('45Z-Mass-Balance-Ledger_TATOBIN_2026_20261105.csv');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith('Producer code,Producer name,Split ID,Field,Enrollment ID')).toBe(true);
    expect(lines[1]).toContain('TATOBIN,T-A TOBIN FARMS LC,TATOB28,NORTH,CI-2026-TATOB28,2026,Corn,80,44000,2,2874.46,');
    expect(lines[2]).toContain('TATOBIN,T-A TOBIN FARMS LC,TATOB29,SOUTH,CI-2026-TATOB29,2026,Corn,80,25000,1,2034,');
  });

  it('should not offer or download the ledger without a producer or a confirmed field', () => {
    render();
    expand();
    expect(ledgerButton()).toBeUndefined();

    confirm('NORTH', 2874, [ticket(1, 44_000)]);
    render(CI_PROGRAM.key, null);
    expand();
    expect(ledgerButton()).toBeUndefined();
    card.downloadLedger();
    expect(downloadCsv).not.toHaveBeenCalled();
  });
});
