import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FdCicApiService } from '../../../../data-access/fd-cic-api.service';
import { FdCicData, FieldProgramRecord, FieldSeason, ProducerField } from '@models';
import { FdCicIntakeComponent } from './fd-cic-intake.component';
import { fakeFdCicApi } from './fd-cic.testing';

const season: FieldSeason = { id: 's1', fieldKey: 'TATOB28', plantingIntentionId: 1, year: 2026, cropLabel: 'Irrigated Corn', acres: 80 };
const field: ProducerField = {
  fieldKey: 'TATOB28', splitId: 'TATOB28', customerId: 9, name: 'PENKA #1 IRR', splitPercent: 100, effectiveDate: '2018-10-01', state: 'KS', county: 'Pratt',
};
const data: FdCicData = {
  expectedYield: 200, actualYield: null, syntheticN: 180, niFraction: 0, coverCrop: 'None', tillage: 'NoTill', manure: [],
};
const record: FieldProgramRecord<FdCicData> = { id: 'r1', seasonId: 's1', programKey: '45z-fdcic', data, status: 'Ready' };

describe('FdCicIntakeComponent', () => {
  let component: FdCicIntakeComponent;
  let fixture: ComponentFixture<FdCicIntakeComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: FdCicApiService, useValue: fakeFdCicApi() }] });
    fixture = TestBed.createComponent(FdCicIntakeComponent);
    fixture.componentRef.setInput('record', record);
    fixture.componentRef.setInput('season', season);
    fixture.componentRef.setInput('field', field);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('should name the components each input feeds, from the calculator\'s breakdown', () => {
    expect(component.affects('Tillage')).toBe('Affects field N₂O, soil carbon (credit), on-farm energy.');
    expect(component.affects('N rate')).toBe('Affects nitrogen fertilizer, field N₂O, urea & lime.');
    expect(component.affects('Nitrification inhibitor')).toBe('Affects field N₂O.');
  });

  it('should never say an input affects a component with no input, such as other chemicals', () => {
    for (const driver of ['Tillage', 'Cover crop', 'N rate', 'Nitrification inhibitor', 'Manure']) {
      expect(component.affects(driver)).not.toContain('other chemicals');
    }
  });

  it('should take the stored inputs again when they change under it, e.g. copied in, so an edit never writes old inputs back', () => {
    fixture.componentRef.setInput('record', { ...record, data: { ...data, syntheticN: 120, tillage: 'ReducedTill' } });
    fixture.detectChanges();

    expect(component.draft).toMatchObject({ syntheticN: 120, tillage: 'ReducedTill' });
  });

  it('should keep the same draft while the store holds what was typed, so no keystroke is lost', () => {
    const draft = component.draft;
    fixture.componentRef.setInput('record', { ...record, data: { ...data } });
    fixture.detectChanges();

    expect(component.draft).toBe(draft);
  });
});
