import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { Customer } from '@models';
import { ApiService } from '@core/services/api.service';
import { providePermissions } from '@testing/permission.stub';
import { producerProfile } from '@testing/producer-profiles.fake';
import { ProducerProfileStore } from '../../data-access/producer-profile.store';
import { AcresBadgeComponent } from './acres-badge.component';

/** The acres on a customer list row, which Producers adds beside the producer's name. */
describe('AcresBadgeComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: { getAllProducerDetails: () => of([]) } }, providePermissions()] });
  });

  function render(id: number): string {
    const fixture = TestBed.createComponent(AcresBadgeComponent);
    fixture.componentRef.setInput('customer', { id, name: `P${id}` } as Customer);
    fixture.detectChanges();
    return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it("shows the farm acres in the producer's saved details, and 0 without any", () => {
    TestBed.inject(ProducerProfileStore).put(producerProfile(1, { totalAcres: 1200 }));

    expect(render(1)).toBe('1,200 acres');
    expect(render(2)).toBe('0 acres');
  });
});
