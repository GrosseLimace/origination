import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CtrmSplit, Customer, FieldSeason, PlantingIntention } from '@models';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { CtrmSplitApiService } from '../../data-access/ctrm-split-api.service';
import { FdCicApiService } from '../../data-access/fd-cic-api.service';
import { CropFieldsPanelComponent, splitFromText, splitIdFromText } from './crop-fields-panel.component';
import { ProgramRegistry } from './programs/program-registry';
import { FieldPlanStore } from './store/field-plan.store';

const split = (splitId: string, fieldName: string): CtrmSplit => ({
  splitId, fieldName, primaryCustomerId: 'TATOBIN', name: `TATOBIN - ${fieldName}`, splitPercent: 100, effectiveDate: '2018-10-01', expired: false, kind: 'Field',
});
const splits = [split('TATOB02', 'HOME PLACE IRR'), split('TATOB03', 'SOUTH PIVOT IRR')];

describe('splitFromText (the add-field type-ahead)', () => {
  it('should find a split picked from the list, "ID · field name"', () => {
    expect(splitFromText('TATOB02 · HOME PLACE IRR', splits)?.splitId).toBe('TATOB02');
  });

  it('should find a split by its ID or its exact field name, in any case', () => {
    expect(splitFromText(' tatob03 ', splits)?.splitId).toBe('TATOB03');
    expect(splitFromText('south pivot irr', splits)?.splitId).toBe('TATOB03');
  });

  it('should find nothing for text that is none of the producer\'s splits', () => {
    expect(splitFromText('TATOB09', splits)).toBeUndefined();
    expect(splitFromText('SOUTH', splits)).toBeUndefined();
    expect(splitFromText('  ', splits)).toBeUndefined();
  });
});

// SPLITS-GRAPHQL: split IDs typed by hand until CTRM's splits query is live.
describe('splitIdFromText (a split ID typed by hand)', () => {
  it('should take a CTRM-style code, upper-cased, from what was typed', () => {
    expect(splitIdFromText(' tatob43 ')).toBe('TATOB43');
    expect(splitIdFromText('TATOB43 · JARBOE WEST')).toBe('TATOB43');
    expect(splitIdFromText('A1')).toBe('A1');
  });

  it('should refuse what CTRM couldn\'t hold: over 7 characters, punctuation, or nothing', () => {
    expect(splitIdFromText('TATOB430')).toBeUndefined();
    expect(splitIdFromText('TA-TOB')).toBeUndefined();
    expect(splitIdFromText('  ')).toBeUndefined();
  });
});

// "Update total" opens the intention's Edit dialog, so it shows only to a user who may change intentions.
describe('CropFieldsPanelComponent — "Update total" when the fields add up to more than the row', () => {
  let access: PermissionStub;

  function render(granted: Parameters<typeof permissionStub>[0]) {
    access = permissionStub(granted);
    // One field of 300 ac under a 250 ac row.
    const season: FieldSeason = { id: 's1', fieldKey: 'f1', plantingIntentionId: 1, year: 2026, cropLabel: 'Corn', acres: 300 };
    TestBed.configureTestingModule({
      providers: [
        providePermissions(access),
        {
          provide: FieldPlanStore,
          useValue: {
            isLoaded: () => true, loadFailed: () => false, seasonsForIntention: () => [season], hasLocked: () => false,
            field: () => ({ name: 'North', splitId: 'TATOB02', county: 'Pratt', state: 'KS', splitPercent: 100 }),
            forSeason: () => [], find: () => undefined, enrollmentIdOf: () => undefined,
          },
        },
        { provide: ProgramRegistry, useValue: { eligible: () => [], get: () => undefined } },
        { provide: FdCicApiService, useValue: {} },
        { provide: CtrmSplitApiService, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(CropFieldsPanelComponent);
    fixture.componentRef.setInput('intention', { id: 1, plantingYear: 2026, acres: 250 } as PlantingIntention);
    fixture.componentRef.setInput('customer', { id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms' } as Customer);
    fixture.componentRef.setInput('cropLabel', 'Corn');
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    return fixture;
  }

  it('offers it only to a user who may change intentions', () => {
    const fixture = render(['field-plans:read']);
    const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text()).toContain('more than the 250 ac on this row');
    expect(text()).not.toContain('Update total to 300');

    access.grant('field-plans:read', 'planting-intentions:write');
    fixture.detectChanges();

    expect(text()).toContain('Update total to 300');
  });
});
