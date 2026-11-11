import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CustomerListFilter, KeptCustomers } from '@core/context/customer-list-filter';
import { SavedList } from '../../models/saved-list.model';
import { SavedListFilterStore } from '../../data-access/saved-list-filter.store';
import { SavedListsStore } from '../../data-access/saved-lists.store';
import { SavedListFilterComponent } from './saved-list-filter.component';

const list = (id: number, name: string): SavedList => ({ id, name, query: 'q', tradeUnits: 'TU1', createdAt: '' });

describe('SavedListFilterComponent', () => {
  let fixture: ComponentFixture<SavedListFilterComponent>;
  let filter: CustomerListFilter;
  let store: {
    options: ReturnType<typeof signal<SavedList[]>>;
    selectedId: ReturnType<typeof signal<string>>;
    count: ReturnType<typeof signal<number>>;
    kept: ReturnType<typeof computed<KeptCustomers>>;
    select: ReturnType<typeof vi.fn<(id: string) => void>>;
  };
  let lists: { load: ReturnType<typeof vi.fn> };
  const select = (): HTMLSelectElement | null => (fixture.nativeElement as HTMLElement).querySelector('select');

  beforeEach(() => {
    const selectedId = signal('all');
    store = {
      options: signal([list(10, 'Kansas growers'), list(11, 'Corn')]),
      selectedId,
      count: signal(0),
      kept: computed<KeptCustomers>(() => selectedId() === 'all' ? { kind: 'all' } : { kind: 'some', ids: new Set([1]) }),
      select: vi.fn<(id: string) => void>(id => selectedId.set(id)),
    };
    lists = { load: vi.fn(() => of(null)) };
    TestBed.configureTestingModule({
      imports: [SavedListFilterComponent],
      providers: [
        CustomerListFilter,
        { provide: SavedListFilterStore, useValue: store },
        { provide: SavedListsStore, useValue: lists },
      ],
    });
    filter = TestBed.inject(CustomerListFilter);
    fixture = TestBed.createComponent(SavedListFilterComponent);
    fixture.detectChanges();
  });

  it("offers All Producers and the user's lists, and reads them again as the page opens", () => {
    expect(Array.from(select()!.options).map(o => o.textContent?.trim())).toEqual(['All Producers', 'Kansas growers', 'Corn']);
    expect(lists.load).toHaveBeenCalledTimes(1);
  });

  it("shows nothing while there's no list to offer", () => {
    store.options.set([]);
    fixture.detectChanges();
    expect(select()).toBeNull();
  });

  it('picks a list, telling the customer list first so it leaves its search, and passes on who the list keeps', () => {
    let picked = 0;
    filter.picked.subscribe(() => picked++);

    const el = select()!;
    el.value = '10';
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(picked).toBe(1);
    expect(store.select).toHaveBeenCalledWith('10');
    expect(filter.kept()).toEqual({ kind: 'some', ids: new Set([1]) });
  });

  it("names the picked list's count", () => {
    store.select('10');
    store.count.set(2);
    fixture.detectChanges();
    expect(select()!.options[1].textContent?.trim()).toBe('Kansas growers (2)');
  });

  it("goes back to All Producers when the customer list is reset", () => {
    store.select('10');
    fixture.detectChanges();

    filter.clear();
    fixture.detectChanges();

    expect(store.select).toHaveBeenLastCalledWith('all');
    expect(filter.kept()).toEqual({ kind: 'all' });
  });
});
