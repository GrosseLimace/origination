// Angular core
import { Injectable, computed, inject, signal } from '@angular/core';

// Angular HTTP
import { HttpClient } from '@angular/common/http';

// RxJS
import { firstValueFrom } from 'rxjs';

// Models
import { HelpContent, HelpFaq } from '@models';

// Environment
import { environment } from '../../../environments/environment';

/**
 * The self-help content: every question, the Help page categories, and the per-screen suggestions.
 *
 * Loaded once, on first use (opening the panel or the Help page), rather than at startup — most
 * sessions never open help, and the content is static for the life of a deploy. Matching a typed
 * question against it happens locally in shared/utils/help-match.ts.
 */
@Injectable({ providedIn: 'root' })
export class HelpService {
  private readonly http = inject(HttpClient);

  private readonly _content = signal<HelpContent | null>(null);
  private readonly _failed = signal(false);
  private loading: Promise<void> | null = null;

  readonly content = this._content.asReadonly();
  /** True when the last load failed. The panel offers a retry instead of empty suggestions. */
  readonly failed = this._failed.asReadonly();

  readonly faqs = computed<readonly HelpFaq[]>(() => this._content()?.faqs ?? []);

  private readonly faqIndex = computed(() => new Map(this.faqs().map(f => [f.id, f])));

  /** Loads the content if it isn't already loaded or loading. Safe to call repeatedly. */
  load(): Promise<void> {
    if (this._content() !== null) return Promise.resolve();
    if (this.loading) return this.loading;

    this._failed.set(false);
    this.loading = firstValueFrom(this.http.get<HelpContent>(`${environment.apiBaseUrl}/help`))
      .then(content => this._content.set(content))
      .catch(() => this._failed.set(true))
      .finally(() => (this.loading = null));
    return this.loading;
  }

  faq(id: string): HelpFaq | undefined {
    return this.faqIndex().get(id);
  }

  /** The questions to suggest on a route: its own list, else the "*" fallback. */
  suggestionsFor(route: string): HelpFaq[] {
    const suggestions = this._content()?.suggestions ?? {};
    const ids = suggestions[route] ?? suggestions['*'] ?? [];
    return ids.map(id => this.faq(id)).filter((f): f is HelpFaq => f !== undefined);
  }
}
