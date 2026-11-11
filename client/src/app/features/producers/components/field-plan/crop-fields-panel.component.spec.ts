import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Customer, PlantingIntention } from '@models';
import { CtrmSplit, FieldSeason } from '../../models/field-plan.model';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { ProducerProfilesFake, producerProfile, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
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

/** The panel for a 250 ac Corn row with one 300 ac field, North, and one program it could join. */
function renderPanel(access: PermissionStub, profiles: ProducerProfilesFake = producerProfilesFake()) {
  const season: FieldSeason = { id: 's1', fieldKey: 'f1', plantingIntentionId: 1, year: 2026, cropLabel: 'Corn', acres: 300 };
  TestBed.configureTestingModule({
    providers: [
      providePermissions(access),
      provideProducerProfiles(profiles),
      {
        provide: FieldPlanStore,
        useValue: {
          isLoaded: () => true, loadFailed: () => false, seasonsForIntention: () => [season], hasLocked: () => false,
          field: () => ({ name: 'North', splitId: 'TATOB02', county: 'Pratt', state: 'KS', splitPercent: 100 }),
          forSeason: () => [], find: () => undefined, enrollmentIdOf: () => undefined,
        },
      },
      { provide: ProgramRegistry, useValue: { eligible: () => [{ key: 'water', label: 'Water stewardship', description: '' }], get: () => undefined } },
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

// The field's reports (the Biofuel Feedstock Report among them) name the producer, and their primary contact from the
// producer's saved details.
describe('CropFieldsPanelComponent — the producer its reports name', () => {
  const name = (...profiles: Parameters<typeof producerProfile>[]) =>
    renderPanel(permissionStub(['field-plans:read']), producerProfilesFake(profiles.map(p => producerProfile(...p))))
      .componentInstance.producerForExport();

  it('names the starred contact, else the legacy primary contact, else none', () => {
    expect(name([42, { contacts: [{ name: 'Office' }, { name: ' Pat ', isPrimary: true }], primaryContact: 'Old' }]))
      .toEqual({ code: 'SAMPFRM', name: 'Sample Farms', primaryContact: 'Pat' });
    TestBed.resetTestingModule();
    expect(name([42, { primaryContact: ' Old ' }]).primaryContact).toBe('Old');
    TestBed.resetTestingModule();
    expect(name().primaryContact).toBeNull();
  });
});

// "Update total" opens the intention's Edit dialog, so it shows only to a user who may change intentions.
describe('CropFieldsPanelComponent — "Update total" when the fields add up to more than the row', () => {
  it('offers it only to a user who may change intentions', () => {
    const access = permissionStub(['field-plans:read']);
    const fixture = renderPanel(access);
    const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text()).toContain('more than the 250 ac on this row');
    expect(text()).not.toContain('Update total to 300');

    access.grant('field-plans:read', 'planting-intentions:write');
    fixture.detectChanges();

    expect(text()).toContain('Update total to 300');
  });
});

// Adding, changing and removing fields and their programs needs field-plans:write; without it the panel is read-only.
describe('CropFieldsPanelComponent — for a user who may not change field plans', () => {
  it('shows the fields read-only, and the controls once the user may change field plans', async () => {
    const access = permissionStub(['field-plans:read']);
    const fixture = renderPanel(access);
    const host = fixture.nativeElement as HTMLElement;
    const acres = () => host.querySelector<HTMLInputElement>('input[aria-label="Acres"]')!;
    const buttonText = () => Array.from(host.querySelectorAll('button')).map(b => (b.textContent ?? '').trim());
    // ngModel applies [disabled] a tick later.
    const settle = async () => { fixture.detectChanges(); await new Promise(r => setTimeout(r, 0)); fixture.detectChanges(); };
    await settle();

    expect(host.textContent).toContain('North');
    expect(acres().disabled).toBe(true);
    expect(buttonText()).not.toContain('+ Add field');
    expect(buttonText()).not.toContain('Add program ▾');
    expect(host.querySelector('[aria-label="Remove North"]')).toBeNull();
    expect(host.textContent).toContain('None yet');

    access.grant('field-plans:read', 'field-plans:write');
    await settle();

    expect(acres().disabled).toBe(false);
    expect(buttonText()).toContain('+ Add field');
    expect(buttonText()).toContain('Add program ▾');
    expect(host.querySelector('[aria-label="Remove North"]')).not.toBeNull();
  });
});
