import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerDetail, MobileApiService, ProducerDetails, ProducerDetailsUpdate } from '../../../core/api/mobile-api.service';
import { NoticeService } from '../../../core/errors/notice.service';
import { ContactCardComponent } from './contact-card.component';
import { FarmCardComponent } from './farm-card.component';
import { OverviewTab } from './overview.tab';

const HOME = '11111111-1111-4111-8111-111111111111';
const NORTH = '22222222-2222-4222-8222-222222222222';

function details(): ProducerDetails {
  return {
    customerId: 7,
    totalAcres: 900,
    binSites: [
      { siteKey: HOME, name: 'Home', capacity: 50000, latitude: 41.256512345, longitude: -95.934512345 },
      { siteKey: NORTH, name: 'North', capacity: null },
    ],
    grainOnFarm: [
      { binSiteKey: HOME, binSiteName: 'Home', commodityCode: 'YC', bushelsOnHand: 10000, bushelsSold: 4000, lastBid: 4.12, grade: '#2' },
      { binSiteKey: null, commodityCode: 'SB', bushelsOnHand: 500 }, // saved before sites existed
    ],
    modifiedAt: '2026-10-01T00:00:00Z',
  };
}

const CUSTOMER: CustomerDetail = {
  id: 7, name: 'Producer A', phone: '402-555-0100', email: 'a@x.com',
  contacts: [{ name: 'Pat', phone: '402-555-0111', isPrimary: true }, { name: 'Shop', email: 'shop@x.com', isPrimary: false }],
};

/* eslint-disable @typescript-eslint/no-explicit-any */
// The first render compiles both cards; on a busy CI runner that alone can pass the default 5 s.
describe('Overview: contact and farm editing', { timeout: 20_000 }, () => {
  let sent: ProducerDetailsUpdate | undefined;
  const api = {
    getProducerDetails: vi.fn(async () => details()),
    getPlantingCommodities: vi.fn(async () => [{ code: 'YC', name: 'Yellow Corn' }, { code: 'SB', name: 'Soybeans' }, { code: 'WW', name: 'Wheat' }]),
    updateProducerDetails: vi.fn(async (_id: number, body: ProducerDetailsUpdate) => { sent = body; return details(); }),
  };
  const notices = { info: vi.fn(), error: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      imports: [OverviewTab],
      providers: [{ provide: MobileApiService, useValue: api }, { provide: NoticeService, useValue: notices }],
    });
    const fixture = TestBed.createComponent(OverviewTab);
    fixture.componentRef.setInput('customer', CUSTOMER);
    await fixture.whenStable();
    fixture.detectChanges();
    const farm = fixture.debugElement.query(By.directive(FarmCardComponent)).componentInstance as any;
    const contact = fixture.debugElement.query(By.directive(ContactCardComponent)).componentInstance as any;
    return { fixture, farm, contact, el: fixture.nativeElement as HTMLElement };
  }

  const submit = () => new Event('submit');

  beforeEach(() => {
    sent = undefined;
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('shows entered contacts first (primary starred), then the producer’s own phone and email', async () => {
    const { el } = await render();
    const text = el.querySelector('#ov-contact')!.closest('section')!.textContent!;
    expect(text.indexOf('Pat')).toBeLessThan(text.indexOf('(402) 555-0100')); // formatted like the desktop
    expect(text).toContain('★');
    expect(text).toContain('a@x.com');
  });

  it('quick-adding grain at a site sends the whole record back with every read field kept', async () => {
    const { farm } = await render();
    farm.openQuickGrain(NORTH);
    farm.patchQuickGrain({ code: 'WW', total: '1,200', target: '-0.35' });
    await farm.saveQuickGrain(submit(), NORTH);

    expect(sent?.totalAcres).toBe(900);
    expect(sent?.binSites?.[0]).toEqual({ siteKey: HOME, name: 'Home', capacity: 50000, latitude: 41.256512345, longitude: -95.934512345 });
    expect(sent?.grainOnFarm?.[0]).toMatchObject({ binSiteKey: HOME, commodityCode: 'YC', lastBid: 4.12, grade: '#2' });
    expect(sent?.grainOnFarm?.[2]).toMatchObject({ binSiteKey: NORTH, commodityCode: 'WW', bushelsOnHand: 1200, targetBushels: -0.35 });
    expect(sent?.expectedModifiedAt).toBe('2026-10-01T00:00:00Z');
    expect(sent && 'contacts' in sent).toBe(false); // contacts untouched by a farm save
  });

  it('offers only commodities not already at that site', async () => {
    const { farm } = await render();
    expect(farm.availableCommodities(HOME).map((c: any) => c.code)).toEqual(['SB', 'WW']);
  });

  it('Edit saves acres and every site and grain row, keeping full-precision coordinates', async () => {
    const { farm } = await render();
    farm.startEdit();
    farm.editAcres.set('1,250');
    await farm.saveEdit(submit());

    expect(sent?.totalAcres).toBe(1250);
    expect(sent?.binSites?.[0]).toMatchObject({ latitude: 41.256512345, longitude: -95.934512345 });
    expect(sent?.grainOnFarm).toHaveLength(2);
    expect(sent?.grainOnFarm?.[0]).toMatchObject({ commodityCode: 'YC', bushelsOnHand: 10000, bushelsSold: 4000, lastBid: 4.12 });
  });

  it('Edit: removing a site keeps its grain, no longer tied to a site; unlinked grain can be moved to a site', async () => {
    const { farm } = await render();
    farm.startEdit();
    farm.removeSite(0);              // Home
    farm.moveGrain(1, NORTH);        // the old SB row onto North
    await farm.saveEdit(submit());

    expect(sent?.binSites?.map((s) => s.name)).toEqual(['North']);
    expect(sent?.grainOnFarm?.[0]).toMatchObject({ commodityCode: 'YC', binSiteKey: null });
    expect(sent?.grainOnFarm?.[1]).toMatchObject({ commodityCode: 'SB', binSiteKey: NORTH });
  });

  it('Edit blocks the save while a site has no name or a location cannot be read', async () => {
    const { farm, fixture, el } = await render();
    farm.startEdit();
    farm.patchSiteFn(1)({ name: '  ' });
    await farm.saveEdit(submit());
    fixture.detectChanges();
    expect(el.textContent).toContain('Each bin site needs a name.');

    farm.patchSiteFn(1)({ name: 'North', coords: 'somewhere' });
    await farm.saveEdit(submit());
    expect(api.updateProducerDetails).not.toHaveBeenCalled();
  });

  it('editing contacts sends them primary first, drops empty rows, and keeps the farm as read', async () => {
    const { contact, fixture } = await render();
    const changed = vi.fn();
    fixture.componentInstance.contactsChanged.subscribe(changed);

    contact.startEdit();
    contact.addRow();
    contact.patch(2, { name: ' Dad ', phone: ' 402-555-0122 ' });
    contact.addRow();                // left empty: dropped
    contact.makePrimary(2);
    await contact.save(submit());

    expect(sent?.contacts).toEqual([
      { name: 'Dad', phone: '402-555-0122', email: null, isPrimary: true },
      { name: 'Pat', phone: '402-555-0111', email: null, isPrimary: false },
      { name: 'Shop', phone: null, email: 'shop@x.com', isPrimary: false },
    ]);
    expect(sent?.totalAcres).toBe(900);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('only one card can be in edit mode at a time (one Save, not two)', async () => {
    const { contact, farm, fixture } = await render();
    contact.startEdit();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(farm.locked()).toBe(true);
    const farmButtons = [...fixture.nativeElement.querySelectorAll('mob-farm-card button')].map((b: HTMLElement) => b.textContent!.trim());
    expect(farmButtons).not.toContain('Edit');
    expect(farmButtons).not.toContain('+ Add bin site');

    contact.editing.set(false);       // Cancel
    fixture.detectChanges();
    await fixture.whenStable();
    expect(farm.locked()).toBe(false);

    farm.openQuickSite();             // a quick add counts as editing too
    fixture.detectChanges();
    await fixture.whenStable();
    expect(contact.locked()).toBe(true);
  });

  it('a contact with a phone or email but no name blocks the save', async () => {
    const { contact } = await render();
    contact.startEdit();
    contact.addRow();
    contact.patch(2, { email: 'x@y.com' });
    await contact.save(submit());
    expect(api.updateProducerDetails).not.toHaveBeenCalled();
  });
});
