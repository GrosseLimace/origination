import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { AccessUsers, ExcludedUser } from '@models';

import { ExcludedUsersPanelComponent } from './excluded-users-panel.component';

function row(over: Partial<ExcludedUser> = {}): ExcludedUser {
  return {
    id: 1, userId: 'CEgr', displayName: 'Caden Egr', reason: 'dev account',
    createdBy: 'admin', createdAt: '2026-08-01T12:00:00', ...over,
  };
}

describe('ExcludedUsersPanelComponent', () => {
  let api: {
    getUsageExcludedUsers: () => Observable<ExcludedUser[]>;
    getUsageAccessUsers: () => Observable<AccessUsers>;
    addUsageExcludedUser: (userId: string, reason?: string) => Observable<ExcludedUser>;
    removeUsageExcludedUser: (id: number) => Observable<void>;
    listCalls: number;
    accessResp: AccessUsers;
    addedWith: { userId: string; reason?: string }[];
    removedIds: number[];
  };
  let toasts: string[];
  let component: ExcludedUsersPanelComponent;

  function build(): ExcludedUsersPanelComponent {
    const fixture = TestBed.createComponent(ExcludedUsersPanelComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    toasts = [];
    api = {
      listCalls: 0,
      // Default: a readable roster → the search-and-select picker is active.
      accessResp: {
        available: true,
        users: [
          { userId: 'SFletcher', displayName: 'Sam Fletcher' },
          { userId: 'BCozart', displayName: 'Bob Cozart' },
        ],
      },
      addedWith: [],
      removedIds: [],
      getUsageExcludedUsers() { this.listCalls++; return of([row()]); },
      getUsageAccessUsers() { return of(this.accessResp); },
      addUsageExcludedUser(userId: string, reason?: string) {
        this.addedWith.push({ userId, reason });
        return of(row({ id: 2, userId, displayName: null, reason: reason ?? null }));
      },
      removeUsageExcludedUser(id: number) { this.removedIds.push(id); return of(undefined as void); },
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: (m: string) => toasts.push(m) } },
      ],
    });
    TestBed.overrideComponent(ExcludedUsersPanelComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    component = build();
  });

  it('does not load the list until the panel is opened', () => {
    expect(api.listCalls).toBe(0);

    component.toggle();
    expect(api.listCalls).toBe(1);
    expect(component.excluded().length).toBe(1);
  });

  it('does not reload an already-loaded list when reopened', () => {
    component.toggle();
    component.toggle();
    component.toggle();

    expect(api.listCalls).toBe(1);
  });

  it('adds the selected access user, clears the picker, and reports the change', () => {
    let changes = 0;
    component.changed.subscribe(() => changes++);
    component.toggle();

    // Pick from the roster rather than typing — no room for a typo.
    component.select({ userId: 'SFletcher', displayName: 'Sam Fletcher' });
    component.newReason.set('QA account');
    component.add();

    expect(api.addedWith).toEqual([{ userId: 'SFletcher', reason: 'QA account' }]);
    expect(component.excluded().some(r => r.userId === 'SFletcher')).toBe(true);
    expect(component.selectedUser()).toBeNull();
    expect(component.newReason()).toBe('');
    // Every panel's numbers depend on this list, so the parent has to reload.
    expect(changes).toBe(1);
  });

  it('does nothing when Add is pressed with no user selected', () => {
    component.toggle();
    component.add();

    expect(api.addedWith).toEqual([]);
  });

  it('explains a duplicate rather than showing a generic failure', () => {
    component.toggle();
    component.select({ userId: 'CEgr', displayName: 'Caden Egr' });
    api.addUsageExcludedUser = () => throwError(() => ({ status: 409 }));
    component.add();

    expect(toasts.some(t => t.includes('already excluded'))).toBe(true);
    expect(component.saving()).toBe(false);
  });

  it('falls back to free-text entry when the access roster is unavailable', () => {
    api.accessResp = { available: false, users: [] };
    component.toggle();
    expect(component.accessAvailable()).toBe(false);

    component.newUserId.set('SFletcher');
    component.newReason.set('QA account');
    component.add();

    expect(api.addedWith).toEqual([{ userId: 'SFletcher', reason: 'QA account' }]);
    expect(component.newUserId()).toBe('');
  });

  it('removes an exclusion and reports the change', () => {
    let changes = 0;
    component.changed.subscribe(() => changes++);
    component.toggle();

    component.remove(component.excluded()[0]);

    expect(api.removedIds).toEqual([1]);
    expect(component.excluded().length).toBe(0);
    expect(changes).toBe(1);
  });

  it('keeps the row and warns when a remove fails', () => {
    api.removeUsageExcludedUser = () => throwError(() => ({ status: 500 }));
    component.toggle();

    component.remove(component.excluded()[0]);

    expect(component.excluded().length).toBe(1);
    expect(toasts.some(t => t.includes('Failed to remove'))).toBe(true);
  });
});
