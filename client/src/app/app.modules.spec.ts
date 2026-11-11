import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CustomerSearch } from '@core/context/customer-search';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { TradeUnitContracts } from '@core/context/trade-unit-contracts';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { ApiService } from '@core/services/api.service';
import { providePermissions } from '@testing/permission.stub';
import { appModuleProviders, appModules } from './app.modules';
import { ContractStore } from './features/contracts/data-access/contract.store';
import { CustomerActivityStore } from './features/contracts/data-access/customer-activity.store';
import { CustomersApiService } from './features/customers/data-access/customers-api.service';
import { ProducerProfileStore } from './features/producers/data-access/producer-profile.store';
import { routes } from './app.routes';

describe("the app's pages and links", () => {
  const pages = appModules.flatMap(module => module.routes ?? []);

  it('gate each page by the reads its own screen makes, as its API calls do', () => {
    expect(Object.fromEntries(pages.map(page => [page.path, page.requires]))).toEqual({
      '': [],
      dashboard: ['planting-estimates:read'],
      'build-list': ['query-library:read', 'saved-lists:read:own'],
      insights: ['customers:read', 'contracts:read', 'tickets:read'],
      'bid-sheet': ['bid-sheets:read'],
      'daily-digest': ['recap-groups:read'],
      'usage-dashboard': ['usage-reports:read'],
      'usage-dashboard/users/:userId': ['usage-reports:read'],
      'whats-new': [],
      help: [],
    });
  });

  it('show each link only to users who may open its page', () => {
    const required = new Map(pages.map(page => ['/' + page.path, page.requires]));

    for (const link of appModules.flatMap(module => module.nav ?? [])) {
      expect(required.get(link.path), link.path).toEqual(link.requires);
    }
  });

  // /api/me/permissions names the user's modules by AppPermissions' nested classes, in kebab case. A module named
  // differently here would never be held, and its preload would never run.
  it("name each module as the API does, and mark as SPA-only exactly those the API doesn't know", () => {
    const apiModules = ['platform', 'customers', 'contracts', 'engagement', 'producers', 'lists', 'bid-sheet', 'usage-analytics'];

    expect(appModules.filter(module => !module.spaOnly).map(module => module.id).filter(id => !apiModules.includes(id))).toEqual([]);
    expect(appModules.filter(module => module.spaOnly).map(module => module.id).sort()).toEqual(['calculators', 'help', 'whats-new']);
  });

  it('list each module once, and send every other path home', () => {
    const ids = appModules.map(module => module.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(routes.at(-1)).toEqual({ path: '**', redirectTo: '' });
  });
});

describe('what core declares and a module implements', () => {
  // Customers' home page and customer list read every producer's details without importing Producers.
  it("gives ProducerProfiles as the Producers module's store", () => {
    TestBed.configureTestingModule({ providers: [appModuleProviders, { provide: ApiService, useValue: {} }, providePermissions()] });

    expect(TestBed.inject(ProducerProfiles)).toBe(TestBed.inject(ProducerProfileStore));
  });

  // Help's troubleshooter, in core, searches customers without importing Customers.
  it("gives CustomerSearch as the Customers module's API client", () => {
    TestBed.configureTestingModule({ providers: [appModuleProviders, providePermissions()] });

    expect(TestBed.inject(CustomerSearch)).toBe(TestBed.inject(CustomersApiService));
  });

  // The customer screen reads the selected producer's contracts, tickets and pricing lines without importing Contracts.
  it("gives SelectedProducerActivity as the Contracts module's activity store, and TradeUnitContracts as its ContractStore", () => {
    TestBed.configureTestingModule({ providers: [appModuleProviders, providePermissions()] });

    expect(TestBed.inject(SelectedProducerActivity)).toBe(TestBed.inject(CustomerActivityStore));
    expect(TestBed.inject(TradeUnitContracts)).toBe(TestBed.inject(ContractStore));
  });
});
