import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataSourceService } from './data-source.service';
import { UserRolesService } from './user-roles.service';

/**
 * The browser side of the ODS / CTRM tester toggle. The server owns the decision; these pin that the
 * client never claims more than the server granted, persists the choice where the interceptor reads it,
 * and reloads on a change so no screen mixes the two sources.
 */
describe('DataSourceService', () => {
  const canChoose = signal(false);
  const defaultSource = signal<'ods' | 'ctrm'>('ods');
  let reloads = 0;

  class TestableDataSourceService extends DataSourceService {
    protected override reload(): void { reloads++; }
  }

  beforeEach(() => {
    localStorage.removeItem(DataSourceService.StorageKey);
    canChoose.set(false);
    defaultSource.set('ods');
    reloads = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: UserRolesService, useValue: { canChooseDataSource: canChoose, defaultDataSource: defaultSource } },
        { provide: DataSourceService, useClass: TestableDataSourceService },
      ],
    });
  });

  it('follows the environment default when the user has not chosen', () => {
    const sut = TestBed.inject(DataSourceService);
    expect(sut.preference()).toBeNull();
    expect(sut.effectiveSource()).toBe('ods');

    defaultSource.set('ctrm');
    expect(sut.effectiveSource()).toBe('ctrm');
  });

  it('ignores a stored preference when the server has not allowed this user to choose', () => {
    // The header the interceptor sends is harmless (the server ignores it), but the UI must not claim
    // the user is on a source the server will not route them to.
    localStorage.setItem(DataSourceService.StorageKey, 'ctrm');
    const sut = TestBed.inject(DataSourceService);

    expect(sut.preference()).toBe('ctrm');
    expect(sut.effectiveSource()).toBe('ods');
    expect(sut.readAheadEnabled()).toBe(true); // local environment flag is on; see the next test for the CTRM case
  });

  it('persists a chosen source and reloads, and setPreference is a no-op for a user who may not choose', () => {
    const sut = TestBed.inject(DataSourceService);

    sut.setPreference('ctrm');
    expect(localStorage.getItem(DataSourceService.StorageKey)).toBeNull();
    expect(reloads).toBe(0);

    canChoose.set(true);
    sut.setPreference('ctrm');
    expect(localStorage.getItem(DataSourceService.StorageKey)).toBe('ctrm');
    expect(sut.effectiveSource()).toBe('ctrm');
    expect(reloads).toBe(1);

    // Choosing what is already chosen does not reload again.
    sut.setPreference('ctrm');
    expect(reloads).toBe(1);

    sut.clearPreference();
    expect(localStorage.getItem(DataSourceService.StorageKey)).toBeNull();
    expect(sut.effectiveSource()).toBe('ods');
    expect(reloads).toBe(2);
  });

  it('reads only the two known values back from storage', () => {
    localStorage.setItem(DataSourceService.StorageKey, 'graphql');
    expect(DataSourceService.readStored()).toBeNull();
    localStorage.setItem(DataSourceService.StorageKey, 'ods');
    expect(DataSourceService.readStored()).toBe('ods');
  });
});
