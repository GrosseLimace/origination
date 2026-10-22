import { describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { render, screen, fireEvent, within } from '@testing-library/angular';
import { TestBed } from '@angular/core/testing';
import type { AppVersionInfo, Customer } from '@models';
import { HelpEscalationComponent } from './help-escalation.component';
import { AppStateService } from '@core/services/app-state.service';
import { HelpPanelService } from '@core/services/help-panel.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { WhatsNewService } from '@core/services/whats-new.service';
import { provideTestEnvironment } from '@testing/test-providers';
import { environment } from '../../../../environments/environment';

const version: AppVersionInfo = { releaseVersion: '2026.10.2', releasedOn: '2026-10-09', commitSha: 'abc1234def', shortSha: 'abc1234', buildNumber: '480', environment: 'Dev' };

async function renderCard(helpDeskUrl = environment.helpDeskUrl) {
  const tracking = { trackHelpTicketOpened: vi.fn() };
  const result = await render(HelpEscalationComponent, {
    providers: provideTestEnvironment({
      extraProviders: [
        { provide: WhatsNewService, useValue: { version: signal(version) } },
        { provide: UsageTrackingService, useValue: { ...tracking, trackHelpNoMatch: vi.fn() } }
      ]
    })
  });
  (result.fixture.componentInstance as { helpDeskUrl: string }).helpDeskUrl = helpDeskUrl;
  const appState = result.fixture.debugElement.injector.get(AppStateService);
  appState.setTradeUnits(['2040']);
  appState.selectCustomer({ id: 7, name: 'PRAIRIE RIDGE FARMS LLC', scoularId: 'PRRIDGE' } as Customer);
  result.fixture.detectChanges();
  return { ...result, tracking };
}

function clipboardSpy() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('HelpEscalationComponent', () => {
  it('shows the details support asks for', async () => {
    await renderCard();

    expect(screen.getByText('Release 2026.10.2 · Build abc1234')).toBeTruthy();
    expect(screen.getByText('2040')).toBeTruthy();
  });

  it('leaves the producer out unless the user ticks the box', async () => {
    const { fixture } = await renderCard();

    expect(screen.queryByText('Producer ID')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /Include producer ID/ }));
    fixture.detectChanges();

    expect(screen.getByText('Producer ID')).toBeTruthy();
    // Only the ID, never the name.
    expect(screen.queryByText('PRAIRIE RIDGE FARMS LLC')).toBeNull();
  });

  describe('with the help desk configured', () => {
    it('walks through the ServiceNow form, topic first', async () => {
      await renderCard();

      const link = screen.getByRole('link', { name: /Open ServiceNow/ }) as HTMLAnchorElement;
      // Exactly the configured form: nothing about the user or the problem is added to the URL.
      expect(link.href).toBe(environment.helpDeskUrl);
      expect(link.rel).toBe('noopener noreferrer');
      expect(screen.getByText(environment.helpDeskTopic)).toBeTruthy();
    });

    it('records that a ticket was opened', async () => {
      const { tracking } = await renderCard();

      const link = screen.getByRole('link', { name: /Open ServiceNow/ });
      // Stop the test browser actually following the link out to ServiceNow.
      link.addEventListener('click', e => e.preventDefault());
      fireEvent.click(link);

      expect(tracking.trackHelpTicketOpened).toHaveBeenCalled();
    });

    it('copies a short description from what the user typed', async () => {
      const writeText = clipboardSpy();
      await renderCard();

      fireEvent.input(screen.getByLabelText(/Short Description/), { target: { value: 'Producer missing from my list' } });
      fireEvent.click(screen.getByRole('button', { name: 'Copy short description' }));

      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('Origination Workbench: Producer missing from my list'));
    });

    it('falls back to the page name when nothing is typed', async () => {
      const writeText = clipboardSpy();
      await renderCard();

      fireEvent.click(screen.getByRole('button', { name: 'Copy short description' }));

      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Origination Workbench: help needed on /)));
    });

    it('copies the details plus room for the user\'s own account into Additional information', async () => {
      const writeText = clipboardSpy();
      await renderCard();

      fireEvent.click(screen.getByRole('button', { name: 'Copy additional information' }));

      await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
      const text = writeText.mock.calls[0][0] as string;
      expect(text).toContain('Trade units: 2040');
      expect(text).toContain('What I was doing / what went wrong:');
      expect(text).not.toContain('PRRIDGE');
    });
  });

  it('starts the ticket from what the user asked Help', async () => {
    const writeText = clipboardSpy();
    const { fixture } = await renderCard();
    // In the app the question comes first and the card is opened from its answer, so ask, then open a
    // fresh card.
    fixture.debugElement.injector.get(HelpPanelService).ask('Contract 44102 is missing');
    const card = TestBed.createComponent(HelpEscalationComponent);
    card.detectChanges();
    const view = within(card.nativeElement as HTMLElement);

    expect((view.getByLabelText(/Short Description/) as HTMLInputElement).value).toBe('Contract 44102 is missing');
    fireEvent.click(view.getByRole('button', { name: 'Copy additional information' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain('What I asked Help: Contract 44102 is missing');
  });

  it('without a help desk, offers the details to send to the Origination team', async () => {
    await renderCard('');

    expect(screen.queryByRole('link', { name: /Open ServiceNow/ })).toBeNull();
    expect(screen.getByText('Send these details to the Origination team.')).toBeTruthy();
  });
});
