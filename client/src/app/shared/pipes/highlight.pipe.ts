import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({ name: 'highlight', standalone: true, pure: true })
export class HighlightPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(text: string | null | undefined, keyword: string | null | undefined): SafeHtml {
    const escaped = this._escapeHtml(text ?? '');
    const kw = (keyword ?? '').trim();
    if (!kw) return this.sanitizer.bypassSecurityTrustHtml(escaped);
    const pattern = new RegExp(`(${this._escapeRegex(kw)})`, 'gi');
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
