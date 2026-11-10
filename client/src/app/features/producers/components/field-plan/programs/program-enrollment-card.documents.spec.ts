import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FdCicApiService } from '../../../data-access/fd-cic-api.service';
import { TDiscApiService } from '../../../data-access/tdisc-api.service';
import { fakeTDiscApi } from './fd-cic/fd-cic-tdisc.testing';
import { fakeFdCicApi } from './fd-cic/fd-cic.testing';
import { createFdCicProgram } from './fd-cic/fd-cic.program';
import { SUSTAINABILITY_PROGRAMS } from './program-registry';
import { FieldPlanStore } from '../store/field-plan.store';
import { FieldPlanDocumentsService } from '../store/field-plan-documents.service';
import { ProgramEnrollmentCardComponent } from './program-enrollment-card.component';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';

describe('ProgramEnrollmentCardComponent: 45Z documents', () => {
  const program = createFdCicProgram(fakeFdCicApi());
  let documents: { enabled: boolean; list: () => Promise<never[]> };
  let access: PermissionStub;

  beforeEach(() => {
    documents = { enabled: true, list: () => Promise.resolve([]) };
    access = permissionStub(['field-plans:write']);
    TestBed.configureTestingModule({ providers: [
      providePermissions(access),
      { provide: SUSTAINABILITY_PROGRAMS, useValue: [program] },
      { provide: FdCicApiService, useValue: fakeFdCicApi() },
      { provide: TDiscApiService, useValue: fakeTDiscApi() },
      { provide: FieldPlanDocumentsService, useValue: documents },
    ] });
  });

  const render = () => {
    const fixture = TestBed.createComponent(ProgramEnrollmentCardComponent);
    fixture.componentRef.setInput('programKey', program.key);
    fixture.componentRef.setInput('customerId', 9);
    fixture.componentRef.setInput('year', 2026);
    fixture.componentRef.setInput('producer', { code: 'TATOBIN', name: 'T-A Tobin Farms' });
    fixture.detectChanges();
    return fixture;
  };
  const button = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-testid="open-45z-documents"]');

  it('should offer the documents before the producer has any 45Z field, so an attestation can come first', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('No 45Z fields yet');
    button(el)!.click();
    expect(fixture.componentInstance.documentsOpen()).toBe(true);
  });

  it('should say an attestation can be uploaded only to a user who may change field plans, and still offer the documents', () => {
    access.grant('field-plans:read');
    const el = render().nativeElement as HTMLElement;

    expect(el.textContent).toContain('No 45Z fields yet.');
    expect(el.textContent).not.toContain('can be uploaded now');
    expect(button(el)).not.toBeNull();
  });

  it('should show the documents button on the folded card once the producer has a field', async () => {
    const store = TestBed.inject(FieldPlanStore);
    const field = (await store.createField({ splitId: 'TATOB28', customerId: 9, name: 'PENKA #1 IRR', splitPercent: 100, effectiveDate: '2018-10-01', state: 'KS', county: 'Pratt' }))!;
    const season = (await store.addSeason(field.fieldKey, 1, 2026, 'Corn', 120))!;
    await store.addRecord(season.id, program.key);

    const el = render().nativeElement as HTMLElement;

    expect(el.textContent).not.toContain('No 45Z fields yet');
    expect(button(el)).not.toBeNull();
  });

  it('should show nothing without the API field plan, where documents aren\'t kept', () => {
    documents.enabled = false;
    const el = render().nativeElement as HTMLElement;
    expect(button(el)).toBeNull();
    expect(el.textContent?.trim()).toBe('');
  });
});
