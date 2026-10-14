import { describe, it, expect } from 'vitest';
import { signal } from '@angular/core';
import { render, screen, fireEvent } from '@testing-library/angular';
import type { AppVersionInfo, Customer } from '@models';
import { HelpEscalationComponent } from './help-escalation.component';
import { AppStateService } from '@core/services/app-state.service';
import { WhatsNewService } from '@core/services/whats-new.service';
import { provideTestEnvironment } from '@testing/test-providers';

const version: AppVersionInfo = { releaseVersion: '2026.10.2', releasedOn: '2026-10-09', commitSha: 'abc1234def', shortSha: 'abc1234', buildNumber: '480', environment: 'Dev' };

async function renderCard() {
  const result = await render(HelpEscalationComponent, {
    providers: provideTestEnvironment({ extraProviders: [{ provide: WhatsNewService, useValue: { version: signal(version) } }] })
  });
  const appState = result.fixture.debugElement.injector.get(AppStateService);
  appState.setTradeUnits(['2040']);
  appState.selectCustomer({ id: 7, name: 'PRAIRIE RIDGE FARMS LLC', scoularId: 'PRRIDGE' } as Customer);
  result.fixture.detectChanges();
  return result;
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
    expect(screen.queryByText('PRAIRIE RIDGE FARMS LLC')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /Include producer ID/ }));
    fixture.detectChanges();

    expect(screen.getByText('Producer ID')).toBeTruthy();
    // Only the ID, never the name.
    expect(screen.queryByText('PRAIRIE RIDGE FARMS LLC')).toBeNull();
  });

  it('shows no help desk link until one is configured', async () => {
    await renderCard();

    expect(screen.queryByRole('link', { name: /help desk ticket/ })).toBeNull();
    expect(screen.getByText('Send these details to the Origination team.')).toBeTruthy();
  });
});
