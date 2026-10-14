import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { AppStateService } from '@core/services/app-state.service';
import { HelpPanelService } from '@core/services/help-panel.service';
import { WhatsNewService } from '@core/services/whats-new.service';
import { HelpIconComponent } from '@shared/components/help-icon/help-icon.component';
import { environment } from '../../../../environments/environment';

/** Screen names for the support details, by route. */
const PAGE_NAMES: Record<string, string> = {
  '/': 'Producers',
  '/build-list': 'Build a List',
  '/dashboard': 'Planting Intentions Dashboard',
  '/insights': 'Actionable Insights',
  '/bid-sheet': 'Bid Sheet',
  '/daily-digest': 'Manage Groups',
  '/unshipped-bushels': 'Unshipped Bushels',
  '/help': 'Help'
};

/**
 * "Still need help?": the details support asks for first, captured from the app so the user doesn't
 * have to find them, plus a copy button and the help desk link.
 *
 * Deliberately excluded: tokens, anything from storage, and producer data. The selected producer's
 * Scoular ID goes in only when the user ticks the box. The help desk link is a plain link with
 * nothing in its URL — the details travel by the user's clipboard, never by query string — and it
 * only appears once environment.helpDeskUrl is set.
 */
@Component({
  selector: 'app-help-escalation',
  standalone: true,
  imports: [HelpIconComponent],
  providers: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help-escalation.component.html'
})
export class HelpEscalationComponent {
  private readonly appState = inject(AppStateService);
  private readonly panel = inject(HelpPanelService);
  private readonly whatsNew = inject(WhatsNewService);
  private readonly datePipe = inject(DatePipe);

  readonly helpDeskUrl = environment.helpDeskUrl;
  readonly includeProducer = signal(false);
  readonly copied = signal(false);
  readonly copyFailed = signal(false);

  /** The selected producer's Scoular ID, offered as an opt-in. */
  readonly producerId = computed(() => this.appState.selectedCustomer()?.scoularId ?? null);

  readonly rows = computed(() => {
    const v = this.whatsNew.version();
    const route = this.panel.route();
    const error = this.panel.lastError();
    const units = this.appState.allProducersMode() ? 'All Producers' : [...this.appState.inScopeTradeUnitCodes()].join(', ') || 'None selected';
    const viewed = [...new Set(this.panel.thread().flatMap(t => (t.kind === 'answer' ? [t.faqId] : [])))];

    const rows = [
      { label: 'Release', value: v ? `${v.releaseVersion ? 'Release ' + v.releaseVersion : 'Unreleased'} · Build ${v.shortSha}` : 'Unknown' },
      { label: 'Environment', value: environment.envName },
      { label: 'Page', value: `${PAGE_NAMES[route] ?? route} (${route})` },
      { label: 'Trade units', value: units },
      { label: 'Last error', value: error ? `${error.message} · ${this.datePipe.transform(error.at, 'shortTime')}` : 'None' },
      { label: 'Browser', value: browserName() }
    ];
    if (viewed.length) rows.push({ label: 'Help topics viewed', value: viewed.join(', ') });
    const pid = this.producerId();
    if (this.includeProducer() && pid) rows.push({ label: 'Producer ID', value: pid });
    return rows;
  });

  async copy(): Promise<void> {
    const text = this.rows().map(r => `${r.label}: ${r.value}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      this.copyFailed.set(false);
    } catch {
      // Clipboard can be blocked by browser policy. The rows are on screen to copy by hand.
      this.copyFailed.set(true);
    }
  }

  toggleProducer(event: Event): void {
    this.includeProducer.set((event.target as HTMLInputElement).checked);
    this.copied.set(false);
  }
}

/** "Edge 141", "Chrome 141", … — enough for support, without the full user-agent string. */
function browserName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const known: [string, RegExp][] = [['Edge', /Edg\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]];
  for (const [name, pattern] of known) {
    const m = ua.match(pattern);
    if (m) return `${name} ${m[1]}`;
  }
  return 'Unknown';
}
