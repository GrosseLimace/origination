import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CustomerMapComponent } from './customer-map.component';
import { AppStateService } from '@core/services/app-state.service';
import { Customer } from '@models';

// The Angular-rendered parts of the producer map: the location-count badge, the "Focused on" legend,
// the close button, and the thin progress bar shown while uncached addresses are being geocoded. The
// map itself is Leaflet drawing into #customer-map outside Angular, so its pins are not asserted on
// here; Leaflet runs for real (happy-dom) only because the geocoding pass starts once the map exists.
//
// The progress bar is the one piece of view state written from async work, after the geocode batch
// request returns or fails, so those tests render, answer the request, and assert on the DOM.

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: 'Sample Farms', location: 'Pratt',
    stateProvince: 'KS', postalCode: '67124',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

describe('CustomerMapComponent', () => {
  let fixture: ComponentFixture<CustomerMapComponent>;
  let ref: ComponentRef<CustomerMapComponent>;
  let http: HttpTestingController;
  let geocodeCache: Map<string, { lat: number; lng: number }>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const badge = (): string => norm(host().querySelector('app-badge')?.textContent);
  const legend = (): string => norm(host().querySelector('.border-t')?.textContent);
  const progressBar = (): Element | null => host().querySelector('.animate-pulse');

  function create(inputs: { customers?: Customer[]; focusedState?: string | null } = {}): void {
    fixture = TestBed.createComponent(CustomerMapComponent);
    ref = fixture.componentRef;
    // Leaflet finds its container by id, so the host has to be in the document.
    document.body.appendChild(host());
    for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
    fixture.detectChanges();
  }

  function setInputs(inputs: { customers?: Customer[]; focusedState?: string | null }): void {
    for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
    fixture.detectChanges();
  }

  /** The map initialises after the first render; let that and the effect it triggers settle. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    geocodeCache = new Map();
    await TestBed.configureTestingModule({
      imports: [CustomerMapComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AppStateService,
          useValue: {
            mapGeocodeCache: geocodeCache,
            setGeocodeCache: (key: string, value: { lat: number; lng: number }) => geocodeCache.set(key, value),
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    host().remove();
  });

  it('counts the producers on the map and follows the customers input', () => {
    create({ customers: [makeCustomer({ id: 1 }), makeCustomer({ id: 2 })] });
    expect(badge()).toBe('2 locations');

    setInputs({ customers: [makeCustomer({ id: 1 }), makeCustomer({ id: 2 }), makeCustomer({ id: 3 })] });
    expect(badge()).toBe('3 locations');
  });

  it('names the focused state in the legend, follows a change, and drops it when unfocused', () => {
    create({ customers: [makeCustomer()], focusedState: 'ia' });
    expect(legend()).toContain('Focused on: Iowa');

    setInputs({ focusedState: 'kansas' });
    expect(legend()).toContain('Focused on: Kansas');

    setInputs({ focusedState: 'saskatchewan' }); // not in the table → capitalised as given
    expect(legend()).toContain('Focused on: Saskatchewan');

    setInputs({ focusedState: null });
    expect(legend()).not.toContain('Focused on');
  });

  it('emits close from the header button', () => {
    create({ customers: [makeCustomer()] });
    let closed = 0;
    fixture.componentInstance.close.subscribe(() => closed++);

    host().querySelector<HTMLButtonElement>('button')!.click();

    expect(closed).toBe(1);
  });

  it('shows the progress bar while uncached addresses geocode, and hides it when the batch returns', async () => {
    create({ customers: [makeCustomer({ id: 1 }), makeCustomer({ id: 2, location: 'Hays', postalCode: '67601' })] });
    await settle();

    const req = http.expectOne(r => r.url.endsWith('/geocode/batch'));
    expect(req.request.body.map((b: { city: string; state: string }) => `${b.city}, ${b.state}`)).toEqual(['Pratt, Kansas', 'Hays, Kansas']);
    expect(progressBar()).not.toBeNull();

    req.flush([
      { key: 'pratt,ks,67124', lat: 37.64, lng: -98.73 },
      { key: 'hays,ks,67601', lat: 38.88, lng: -99.33 },
    ]);
    await settle();

    expect(progressBar()).toBeNull();
    expect(geocodeCache.get('pratt,ks,67124')).toEqual({ lat: 37.64, lng: -98.73 });
  });

  it('hides the progress bar when the geocode batch fails, leaving the approximate pins', async () => {
    create({ customers: [makeCustomer()] });
    await settle();
    expect(progressBar()).not.toBeNull();

    http.expectOne(r => r.url.endsWith('/geocode/batch')).flush('down', { status: 503, statusText: 'Unavailable' });
    await settle();

    expect(progressBar()).toBeNull();
  });

  it('never shows the progress bar when every address is already cached', async () => {
    geocodeCache.set('pratt,ks,67124', { lat: 37.64, lng: -98.73 });
    create({ customers: [makeCustomer()] });
    await settle();

    http.expectNone(r => r.url.endsWith('/geocode/batch'));
    expect(progressBar()).toBeNull();
  });
});
