import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { ModuleManifest } from './module-manifest';
import { APP_MODULES, ModuleRegistry } from './module-registry';

const component = () => Promise.resolve(class {});

/** Two modules contributing to the customer screen, each listed out of order on purpose. */
const modules: ModuleManifest[] = [
  {
    id: 'producers',
    customerTabs: [
      { id: 'storage', requires: ['stored-grain:read'], segments: ['Producer'], label: 'Storage', shortLabel: 'Stor', order: 40, component },
      { id: 'planting', requires: ['planting-intentions:read'], segments: ['Producer'], label: 'Planting', shortLabel: 'Plan', order: 30, component },
    ],
    customerPanels: [
      { slot: 'details', id: 'farm-details', requires: ['producer-details:read'], order: 30, component },
      { slot: 'badges', id: 'organic', requires: ['producer-details:read'], order: 20, component },
    ],
    customerEditSections: [{ id: 'farm', requires: ['producer-details:write'], label: 'Farm', order: 20, component }],
    customerPrintSections: [{ id: 'planting', requires: ['planting-intentions:read'], label: 'Planting', order: 30, component }],
  },
  {
    id: 'contracts',
    customerTabs: [{ id: 'contracts', requires: ['contracts:read'], label: 'Open Contracts', shortLabel: 'Cont', order: 10, component }],
    customerPanels: [{ slot: 'badges', id: 'esign', requires: [], order: 10, component }],
    customerPrintSections: [{ id: 'contracts', requires: ['contracts:read'], label: 'Contracts', order: 20, component }],
  },
];

function registry(access: PermissionStub): ModuleRegistry {
  TestBed.configureTestingModule({ providers: [{ provide: APP_MODULES, useValue: modules }, providePermissions(access)] });
  return TestBed.inject(ModuleRegistry);
}

const ids = (contributions: { id: string }[]) => contributions.map(contribution => contribution.id);

describe("ModuleRegistry: the customer screen's contributions", () => {
  const everything = permissionStub([
    'stored-grain:read', 'planting-intentions:read', 'producer-details:read', 'producer-details:write', 'contracts:read',
  ]);

  it('collects the tabs from every module, in order', () => {
    expect(ids(registry(everything).customerTabs())).toEqual(['contracts', 'planting', 'storage']);
  });

  it("keeps each slot's panels apart, in order", () => {
    const modulesRegistry = registry(everything);

    expect(ids(modulesRegistry.customerPanels('badges'))).toEqual(['esign', 'organic']);
    expect(ids(modulesRegistry.customerPanels('details'))).toEqual(['farm-details']);
    expect(modulesRegistry.customerPanels('sidebar')).toEqual([]);
  });

  it('collects the edit and print sections, in order', () => {
    const modulesRegistry = registry(everything);

    expect(ids(modulesRegistry.customerEditSections())).toEqual(['farm']);
    expect(ids(modulesRegistry.customerPrintSections())).toEqual(['contracts', 'planting']);
  });

  it('leaves out what the user lacks the permissions for, and adds it once they hold them', () => {
    const access = permissionStub(['contracts:read']);
    const modulesRegistry = registry(access);

    expect(ids(modulesRegistry.customerTabs())).toEqual(['contracts']);
    // Needing no permission, eSign shows to everyone.
    expect(ids(modulesRegistry.customerPanels('badges'))).toEqual(['esign']);
    expect(modulesRegistry.customerEditSections()).toEqual([]);

    access.grant('contracts:read', 'planting-intentions:read', 'producer-details:read');

    expect(ids(modulesRegistry.customerTabs())).toEqual(['contracts', 'planting']);
    expect(ids(modulesRegistry.customerPanels('badges'))).toEqual(['esign', 'organic']);
  });

  it('has nothing for the customer screen when no module contributes', () => {
    TestBed.configureTestingModule({ providers: [providePermissions(everything)] });
    const modulesRegistry = TestBed.inject(ModuleRegistry);

    expect(modulesRegistry.customerTabs()).toEqual([]);
    expect(modulesRegistry.customerPanels('badges')).toEqual([]);
  });
});
