import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { TDiscPass } from '../../../../../models/tdisc.model';
import { TDISC_TEST_OPTIONS } from '../fd-cic-tdisc.testing';
import { ReviewTDiscComponent } from './review-tdisc.component';

describe('ReviewTDiscComponent (the pass type-ahead)', () => {
  let fixture: ComponentFixture<ReviewTDiscComponent>;
  let tdisc: ReviewTDiscComponent;
  let emitted: TDiscPass[][];

  beforeEach(() => {
    fixture = TestBed.createComponent(ReviewTDiscComponent);
    fixture.componentRef.setInput('options', TDISC_TEST_OPTIONS);
    fixture.componentRef.setInput('passes', []);
    fixture.componentRef.setInput('result', null);
    fixture.detectChanges();
    tdisc = fixture.componentInstance;
    emitted = [];
    tdisc.passesChange.subscribe(p => emitted.push(p));
  });

  const key = (k: string) => tdisc.onKey(new KeyboardEvent('keydown', { key: k }));

  it('should list the window\'s operations first, then its implements, narrowed by what is typed', () => {
    tdisc.search('harrow');
    expect(tdisc.results().map(r => [r.kind, r.name])).toEqual([
      ['operation', 'Chisel, straight point, coil tine harrow'],
      ['implement', 'HARROW, COILED TINES'],
      ['implement', 'HARROW, DISK, CHISEL (MULCH TILLER)'],
      ['implement', 'HARROW, DISK, TANDEM, LIGHTDUTY'],
      ['implement', 'HARROW, SPIKE TOOTH OR SPRING TOOTH'],
    ]);
  });

  it('should add an operation as one pass per implement, in the chosen window', () => {
    tdisc.search('coil tine');
    key('Enter');

    expect(emitted).toEqual([[
      { window: 'Field_Preparation', implement: 'HARROW, DISK, CHISEL (MULCH TILLER)' },
      { window: 'Field_Preparation', implement: 'HARROW, COILED TINES' },
    ]]);
    expect(tdisc.picked()).toBe('');
    expect(tdisc.open()).toBe(false);
  });

  it('should move through the results with the arrow keys and add the highlighted one', () => {
    tdisc.window.set('Harvest');
    tdisc.search('');
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');

    expect(tdisc.results().length).toBe(3); // Combine, then two harvest implements
    expect(emitted).toEqual([[{ window: 'Harvest', implement: 'RESIDUE MGMT: STALK PULLER CHOPPER' }]]);
  });

  it('should close the list on Escape and say when nothing matches', () => {
    tdisc.search('zzz');
    expect(tdisc.results()).toEqual([]);
    key('Escape');
    expect(tdisc.open()).toBe(false);
  });
});
