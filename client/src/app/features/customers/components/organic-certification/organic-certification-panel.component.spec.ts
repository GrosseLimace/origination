import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { OrganicCertificationPanelComponent } from './organic-certification-panel.component';
import { CustomerOrganicCertification, OrganicCertification, OrganicCertificationScope } from '@models';

/**
 * The three states this panel has to render, plus the ordering and labelling decisions that are
 * easy to get quietly wrong. Values are taken from the captured payloads where possible, so the
 * shapes under test are the ones that actually arrive.
 */
function scope(over: Partial<OrganicCertificationScope> = {}): OrganicCertificationScope {
  return { scope: 'Crops', status: 'Certified', isCertified: true, crops: [], ...over };
}

function certification(over: Partial<OrganicCertification> = {}): OrganicCertification {
  return {
    nopid: '8150000123',
    operationName: 'Hofmeyer Farms / Dale Hofmeyer',
    certifierName: '[MCIA] Minnesota Crop Improvement Association',
    status: 'Certified',
    isCertified: true,
    statusEffectiveDate: '2012-01-09',
    anniversaryDate: '2026-04-01',
    sourceUpdatedOn: '2025-11-07',
    outsideComplianceWindow: false,
    monthsSinceSourceUpdate: 10,
    hasUnresolvedStatusChange: false,
    scopes: [scope()],
    updatedOn: '2026-09-29T00:00:00Z',
    ...over,
  };
}

function payload(over: Partial<CustomerOrganicCertification> = {}): CustomerOrganicCertification {
  return { customerId: 500, nopid: '8150000123', noCertificateOnFile: false, ...over };
}

describe('OrganicCertificationPanelComponent', () => {
  let component: OrganicCertificationPanelComponent;
  let ref: ComponentRef<OrganicCertificationPanelComponent>;
  let fixture: ComponentFixture<OrganicCertificationPanelComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    // happy-dom + JIT can't fetch templateUrl; the logic under test is class-level.
    TestBed.overrideComponent(OrganicCertificationPanelComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    fixture = TestBed.createComponent(OrganicCertificationPanelComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
  });

  it('degrades to the NOP id alone when the fetch has not landed or failed', () => {
    // Null is both "loading" and "failed". The panel showing the id by itself is exactly what it
    // showed before certification data existed, which is better than an error on a profile.
    ref.setInput('nopId', '8150000123');
    ref.setInput('certification', null);
    fixture.detectChanges();

    expect(component.cert()).toBeNull();
    expect(component.noCertificateOnFile()).toBe(false);
    expect(component.scopes()).toEqual([]);
  });

  it('flags a NOP id that has no certification behind it', () => {
    ref.setInput('nopId', '8150000123');
    ref.setInput('certification', payload({ noCertificateOnFile: true }));
    fixture.detectChanges();

    expect(component.noCertificateOnFile()).toBe(true);
    expect(component.cert()).toBeNull();
  });

  it('does not flag a producer who simply has no NOP id', () => {
    // The badge can be showing on the industry code alone. That is legitimate, not a warning.
    ref.setInput('nopId', null);
    ref.setInput('certification', payload({ nopid: null, noCertificateOnFile: false }));
    fixture.detectChanges();

    expect(component.noCertificateOnFile()).toBe(false);
  });

  it('sorts certified scopes before uncertified ones', () => {
    // A trader wants to see what they CAN move before what they cannot.
    ref.setInput('certification', payload({
      certification: certification({
        scopes: [
          scope({ scope: 'Handling', status: 'Surrendered', isCertified: false }),
          scope({ scope: 'Crops', status: 'Certified', isCertified: true }),
        ],
      }),
    }));
    fixture.detectChanges();

    expect(component.scopes().map(s => s.scope)).toEqual(['Crops', 'Handling']);
  });

  it('sorts alphabetically within the same certified state', () => {
    ref.setInput('certification', payload({
      certification: certification({
        scopes: [
          scope({ scope: 'Livestock' }),
          scope({ scope: 'Crops' }),
        ],
      }),
    }));
    fixture.detectChanges();

    expect(component.scopes().map(s => s.scope)).toEqual(['Crops', 'Livestock']);
  });

  it('reads the stale-record flag from the server rather than recomputing it', () => {
    // The compliance window is a business rule with a configurable threshold; the client must not
    // second-guess it, or the two can disagree.
    ref.setInput('certification', payload({
      certification: certification({ outsideComplianceWindow: true }),
    }));
    fixture.detectChanges();

    expect(component.recordStale()).toBe(true);
  });

  describe('the record-age label', () => {
    function labelFor(months: number | null | undefined): string {
      ref.setInput('certification', payload({
        certification: certification({ monthsSinceSourceUpdate: months }),
      }));
      fixture.detectChanges();
      return component.updatedAgeLabel();
    }

    it('says date unknown rather than implying zero when there is no date', () => {
      // The honest failure. "0 months ago" would read as freshly updated.
      expect(labelFor(null)).toBe('date unknown');
      expect(labelFor(undefined)).toBe('date unknown');
    });

    it('reads naturally at the boundaries', () => {
      expect(labelFor(0)).toBe('this month');
      expect(labelFor(1)).toBe('1 month ago');
      expect(labelFor(2)).toBe('2 months ago');
      expect(labelFor(18)).toBe('18 months ago');
    });
  });

  // Past-due is SERVER-computed as of 2026-10-07, when it became a badge signal as well as a panel
  // one. The comparison itself now lives in OrganicCertificationService and is covered there; what
  // these assert is that the panel reads the flag and does not second-guess it from the date — two
  // surfaces doing the same date maths in the browser's timezone is how a badge ends up amber while
  // the panel behind it says the date is fine.
  describe('the past-due annual update', () => {
    it('marks an anniversary the server reports as past due', () => {
      ref.setInput('certification', payload({
        certification: certification({ anniversaryDate: '2020-01-01', anniversaryPastDue: true }),
      }));
      fixture.detectChanges();

      expect(component.anniversaryPastDue()).toBe(true);
    });

    it('does not mark a future one', () => {
      ref.setInput('certification', payload({
        certification: certification({ anniversaryDate: '2099-01-01', anniversaryPastDue: false }),
      }));
      fixture.detectChanges();

      expect(component.anniversaryPastDue()).toBe(false);
    });

    it('trusts the server flag over the date it is shown beside', () => {
      // The flag is the contract. If the panel re-derived past-due from the rendered date it could
      // disagree with the badge, which reads the same flag — exactly the drift this moved to fix.
      ref.setInput('certification', payload({
        certification: certification({ anniversaryDate: '2020-01-01', anniversaryPastDue: false }),
      }));
      fixture.detectChanges();

      expect(component.anniversaryPastDue()).toBe(false);
    });

    it('is false rather than throwing when the date is absent', () => {
      // Roughly 15% of real records carry no anniversary date, so this is the normal path. Absence
      // is not lateness — unlike the compliance window, where a missing date deliberately counts.
      ref.setInput('certification', payload({
        certification: certification({ anniversaryDate: null, anniversaryPastDue: false }),
      }));
      fixture.detectChanges();
      expect(component.anniversaryPastDue()).toBe(false);
    });

    it('is independent of the compliance signal, which measures something else', () => {
      // Both captured samples look like this: inside the 18-month window on "updated on" while
      // already past the next annual update. Collapsing the two would hide a real distinction.
      ref.setInput('certification', payload({
        certification: certification({
          sourceUpdatedOn: '2025-11-07',
          outsideComplianceWindow: false,
          anniversaryDate: '2026-04-01',
          anniversaryPastDue: true,
        }),
      }));
      fixture.detectChanges();

      expect(component.recordStale()).toBe(false);
      expect(component.anniversaryPastDue()).toBe(true);
    });
  });

  it('gives every crop a chip class, including names the palette does not know', () => {
    // A certifier's wording is not a reason to hide a crop, so an unmapped name still gets a chip.
    expect(component.chipClass('Soybeans')).toBeTruthy();
    expect(component.chipClass('Dairy Cows (all eligible for organic slaughter)')).toBeTruthy();
  });
});
