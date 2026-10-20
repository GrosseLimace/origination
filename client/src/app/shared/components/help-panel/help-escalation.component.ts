import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { AppStateService } from '@core/services/app-state.service';
import { HelpPanelService } from '@core/services/help-panel.service';
import { HelpService } from '@core/services/help.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
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
  '/help': 'Help'
};

/** ServiceNow's short description field; kept well inside its limit. Matches the input's maxlength. */
const SHORT_MAX = 100;

type CopyTarget = 'short' | 'details';

/**
 * "Still need help?": the details support asks for first, captured from the app so the user doesn't
 * have to find them, and — when environment.helpDeskUrl is set — a step-by-step walk through the
 * ServiceNow form: open it, pick the topic, then copy the short description and the additional
 * information into its two required boxes.
 *
 * Deliberately excluded: tokens, anything from storage, and producer data. The selected producer's
 * Scoular ID goes in only when the user ticks the box. The help desk link is a plain link with
 * nothing added to its URL — the details travel by the user's clipboard, never by query string —
 * which also means a ServiceNow sign-in redirect can't lose them.
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
  private readonly help = inject(HelpService);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly whatsNew = inject(WhatsNewService);
  private readonly datePipe = inject(DatePipe);

  readonly helpDeskUrl = environment.helpDeskUrl;
  readonly helpDeskTopic = environment.helpDeskTopic;

  readonly includeProducer = signal(false);
  /**
   * The short description, started from what the user asked Help so they don't retype it. Editable,
   * and it goes nowhere but their clipboard.
   */
  readonly summary = signal(this.panel.lastQuestion() ?? '');
  /** Which field was copied last; the clipboard holds one thing at a time. */
  readonly copied = signal<CopyTarget | null>(null);
  readonly copyFailed = signal(false);

  /** The selected producer's Scoular ID, offered as an opt-in. */
  readonly producerId = computed(() => this.appState.selectedCustomer()?.scoularId ?? null);

  readonly pageName = computed(() => {
    const route = this.panel.route();
    return PAGE_NAMES[route] ?? route;
  });

  readonly rows = computed(() => {
    const v = this.whatsNew.version();
    const route = this.panel.route();
    const error = this.panel.lastError();
    const units = this.appState.allProducersMode() ? 'All Producers' : [...this.appState.inScopeTradeUnitCodes()].join(', ') || 'None selected';
    // The last few answers they read, by title: what support needs to know they've already tried.
    const viewed = this.panel.viewedFaqIds().slice(-3).map(id => this.help.faq(id)?.question ?? id);

    const rows = [
      { label: 'Release', value: v ? `${v.releaseVersion ? 'Release ' + v.releaseVersion : 'Unreleased'} · Build ${v.shortSha}` : 'Unknown' },
      { label: 'Environment', value: environment.envName },
      { label: 'Page', value: `${this.pageName()} (${route})` },
      { label: 'Trade units', value: units },
      { label: 'Last error', value: error ? `${error.message} · ${this.datePipe.transform(error.at, 'shortTime')}` : 'None' },
      { label: 'Browser', value: browserName() }
    ];
    if (viewed.length) rows.push({ label: 'Help answers read', value: viewed.join(' / ') });
    const pid = this.producerId();
    if (this.includeProducer() && pid) rows.push({ label: 'Producer ID', value: pid });
    return rows;
  });

  /** For ServiceNow's "Short Description of your issue". */
  readonly shortDescription = computed(() => {
    const typed = this.summary().trim();
    return `Origination Workbench: ${typed || `help needed on ${this.pageName()}`}`.slice(0, SHORT_MAX + 25);
  });

  /** For ServiceNow's "Additional information": the details, then room for the user's own account. */
  readonly additionalInformation = computed(() => {
    const asked = this.panel.lastQuestion();
    return [
      ...(asked ? [`What I asked Help: ${asked}`, ''] : []),
      'Origination Workbench support details',
      ...this.rows().map(r => `${r.label}: ${r.value}`),
      '',
      'What I was doing / what went wrong:',
      ''
    ].join('\n');
  });

  onSummary(event: Event): void {
    this.summary.set((event.target as HTMLInputElement).value);
    if (this.copied() === 'short') this.copied.set(null);
  }

  toggleProducer(event: Event): void {
    this.includeProducer.set((event.target as HTMLInputElement).checked);
    if (this.copied() === 'details') this.copied.set(null);
  }

  /** Without a help desk configured, "Copy details" copies the same block as Additional information. */
  copy(target: CopyTarget): Promise<void> {
    return this.write(target, target === 'short' ? this.shortDescription() : this.additionalInformation());
  }

  openedHelpDesk(): void {
    this.usageTracking.trackHelpTicketOpened();
  }

  private async write(target: CopyTarget, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(target);
      this.copyFailed.set(false);
    } catch {
      // Clipboard can be blocked by browser policy. The details are on screen to copy by hand.
      this.copyFailed.set(true);
    }
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
