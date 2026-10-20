import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, output, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { Subject } from 'rxjs';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { AppComponent } from './app.component';
import { IdleTimeoutService } from '@core/services/idle-timeout.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { UserPreferencesService } from '@core/services/user-preferences.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { WhatsNewService } from '@core/services/whats-new.service';
import { AppInsightsService } from '@core/services/app-insights.service';
import type { WhatsNewRelease } from '@models';

/**
 * The app shell. Everything it shows changes AFTER the first render, from callbacks — never from an
 * input — so each test renders, fires the callback, and asserts on the DOM:
 *  - "Signing in..." until MSAL reports an interaction finished with an account, then the shell,
 *  - the What's New dialog once the release notes finish loading with something unseen, and its
 *    close records the release as seen,
 *  - a routed page that re-renders from its own signal still updates inside the shell (the shell
 *    must not stop pages that are themselves on Default change detection from refreshing).
 *
 * Header, toast container and dialog are selector-compatible stubs; they have their own specs.
 */

@Component({ selector: 'app-header', standalone: true, template: 'header' })
class StubHeader {}

@Component({ selector: 'app-toast-container', standalone: true, template: '' })
class StubToastContainer {}

@Component({ selector: 'app-whats-new-dialog', standalone: true, template: '{{ releases().length }} unseen' })
class StubWhatsNewDialog {
  readonly isOpen = input.required<boolean>();
  readonly releases = input.required<WhatsNewRelease[]>();
  readonly close = output<void>();
}

/** A routed page on Default change detection whose view is driven by a signal set from outside. */
@Component({ selector: 'app-stub-page', standalone: true, template: '<p class="page">count {{ count() }}</p>' })
class StubPage {
  static readonly count = signal(0);
  readonly count = StubPage.count;
}

const RELEASE = { version: '2026.10.14' } as WhatsNewRelease;

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let accounts: { username: string }[];
  let inProgress$: Subject<InteractionStatus>;
  let resolveLoad: () => void;
  let whatsNew: {
    load: ReturnType<typeof vi.fn>;
    hasUnseen: ReturnType<typeof signal<boolean>>;
    unseenReleases: ReturnType<typeof signal<WhatsNewRelease[]>>;
    markCurrentAsSeen: ReturnType<typeof vi.fn>;
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const dialog = (): StubWhatsNewDialog | null =>
    fixture.debugElement.query(By.directive(StubWhatsNewDialog))?.componentInstance ?? null;

  /** The @defer block loads its dependency on a later macrotask, after the trigger flips. */
  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function create(): void {
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    accounts = [];
    inProgress$ = new Subject<InteractionStatus>();
    StubPage.count.set(0);
    whatsNew = {
      load: vi.fn(() => new Promise<void>(resolve => { resolveLoad = resolve; })),
      hasUnseen: signal(false),
      unseenReleases: signal<WhatsNewRelease[]>([]),
      markCurrentAsSeen: vi.fn(),
    };

    TestBed.overrideComponent(AppComponent, {
      set: { imports: [RouterOutlet, StubHeader, StubToastContainer, StubWhatsNewDialog] },
    });
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([{ path: '', component: StubPage }]),
        {
          provide: MsalService,
          useValue: { instance: { getAllAccounts: () => accounts, getActiveAccount: () => accounts[0] ?? null } },
        },
        { provide: MsalBroadcastService, useValue: { inProgress$ } },
        { provide: IdleTimeoutService, useValue: { start: vi.fn() } },
        { provide: DataPreloadService, useValue: {} },
        { provide: UserPreferencesService, useValue: {} },
        { provide: UsageTrackingService, useValue: {} },
        { provide: WhatsNewService, useValue: whatsNew },
        { provide: AppInsightsService, useValue: { start: vi.fn(() => Promise.resolve()) } },
      ],
    }).compileComponents();
  });

  it('shows "Signing in..." until MSAL finishes an interaction with an account, then the shell', () => {
    create();
    expect(host().textContent).toContain('Signing in...');
    expect(host().querySelector('app-header')).toBeNull();

    // An interaction that ends with no account keeps the spinner.
    inProgress$.next(InteractionStatus.None);
    fixture.detectChanges();
    expect(host().textContent).toContain('Signing in...');

    accounts.push({ username: 'someone@example.com' });
    inProgress$.next(InteractionStatus.None);
    fixture.detectChanges();

    expect(host().textContent).not.toContain('Signing in...');
    expect(host().querySelector('app-header')).not.toBeNull();
    expect(host().querySelector('main')).not.toBeNull();
  });

  it('opens the What\'s New dialog when the notes finish loading with an unseen release, and close records it as seen', async () => {
    accounts.push({ username: 'someone@example.com' });
    create();
    expect(whatsNew.load).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();

    whatsNew.unseenReleases.set([RELEASE]);
    whatsNew.hasUnseen.set(true);
    resolveLoad();
    await fixture.whenStable();
    fixture.detectChanges();
    await settle();

    expect(dialog()).not.toBeNull();
    expect(dialog()!.isOpen()).toBe(true);
    expect(host().querySelector('app-whats-new-dialog')!.textContent).toContain('1 unseen');

    dialog()!.close.emit();
    fixture.detectChanges();

    expect(whatsNew.markCurrentAsSeen).toHaveBeenCalledTimes(1);
    expect(dialog()!.isOpen()).toBe(false);
  });

  it('leaves the dialog closed when the notes load with nothing unseen', async () => {
    accounts.push({ username: 'someone@example.com' });
    create();

    resolveLoad();
    await fixture.whenStable();
    fixture.detectChanges();
    await settle();

    expect(dialog()).toBeNull();
  });

  it('keeps a routed Default page refreshing when its own signal changes after render', async () => {
    accounts.push({ username: 'someone@example.com' });
    create();
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host().querySelector('.page')?.textContent).toBe('count 0');

    StubPage.count.set(1);
    fixture.detectChanges();

    expect(host().querySelector('.page')?.textContent).toBe('count 1');
  });
});
