import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { ExcludedUser } from '@models';

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
    addUsageExcludedUser: (userId: string, reason?: string) => Observable<ExcludedUser>;
    removeUsageExcludedUser: (id: number) => Observable<void>;
    listCalls: number;
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
      addedWith: [],
      removedIds: [],
      getUsageExcludedUsers() { this.listCalls++; return of([row()]); },
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

  it('adds an exclusion, clears the form, and reports the change', () => {
    let changes = 0;
    component.changed.subscribe(() => changes++);

    component.newUserId.set('SFletcher');
    component.newReason.set('QA account');
    component.add();

    expect(api.addedWith).toEqual([{ userId: 'SFletcher', reason: 'QA account' }]);
    expect(component.excluded().some(r => r.userId === 'SFletcher')).toBe(true);
    expect(component.newUserId()).toBe('');
    expect(component.newReason()).toBe('');
    // Every panel's numbers depend on this list, so the parent has to reload.
    expect(changes).toBe(1);
  });

  it('ignores an add with a blank user id', () => {
    component.newUserId.set('   ');
    component.add();

    expect(api.addedWith).toEqual([]);
  });

  it('explains a duplicate rather than showing a generic failure', () => {
    api.addUsageExcludedUser = () => throwError(() => ({ status: 409 }));
    component.newUserId.set('CEgr');
    component.add();

    expect(toasts.some(t => t.includes('already excluded'))).toBe(true);
    expect(component.saving()).toBe(false);
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
