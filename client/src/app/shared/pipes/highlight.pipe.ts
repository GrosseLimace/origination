import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({ name: 'highlight', standalone: true, pure: true })
export class HighlightPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  /** keyword may be several words (e.g. a producer's bin site names); each is matched literally,
   *  longest first so "North Bins" wins over "North". The text is HTML-escaped before anything is
   *  wrapped, so only the <mark> tags this adds are markup. */
  transform(text: string | null | undefined, keyword: string | readonly string[] | null | undefined): SafeHtml {
    const escaped = this._escapeHtml(text ?? '');
    const words = (Array.isArray(keyword) ? keyword : [keyword ?? ''])
      .map(k => (k as string).trim()).filter(Boolean)
      .sort((x, y) => y.length - x.length);
    if (words.length === 0) return this.sanitizer.bypassSecurityTrustHtml(escaped);
    const pattern = new RegExp(`(${words.map(w => this._escapeRegex(this._escapeHtml(w))).join('|')})`, 'gi');
    const html = escaped.replace(pattern, '<mark class="bg-yellow-200 dark:bg-yellow-700/60 text-gray-900 dark:text-white rounded px-0.5">$1</mark>');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private _escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
  }

  private _escapeRegex(s: string): string {
    return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  }
}
