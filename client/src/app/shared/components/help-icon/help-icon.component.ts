import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** One SVG child element. Only the attributes this icon set uses. */
interface Shape {
  tag: 'path' | 'circle' | 'line' | 'rect' | 'polyline' | 'polygon';
  d?: string;
  cx?: number; cy?: number; r?: number;
  x1?: number; x2?: number; y1?: number; y2?: number;
  x?: number; y?: number; width?: number; height?: number; rx?: number;
  points?: string;
}

const p = (d: string): Shape => ({ tag: 'path', d });
const circle = (cx: number, cy: number, r: number): Shape => ({ tag: 'circle', cx, cy, r });
const line = (x1: number, y1: number, x2: number, y2: number): Shape => ({ tag: 'line', x1, y1, x2, y2 });

/**
 * Lucide outline icons used by the Help panel and page (the same set the rest of the app inlines).
 * Kept as data and bound attribute-by-attribute, so no markup string is ever injected.
 */
const ICONS: Record<string, Shape[]> = {
  'help-circle': [circle(12, 12, 10), p('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'), p('M12 17h.01')],
  'x': [p('M18 6 6 18'), p('m6 6 12 12')],
  'search': [circle(11, 11, 8), p('m21 21-4.3-4.3')],
  'send': [p('m22 2-7 20-4-9-9-4Z'), p('M22 2 11 13')],
  'arrow-right': [p('M5 12h14'), p('m12 5 7 7-7 7')],
  'chevron-down': [p('m6 9 6 6 6-6')],
  'chevron-up': [p('m18 15-6-6-6 6')],
  'chevron-left': [p('m15 18-6-6 6-6')],
  'check-circle': [p('M22 11.08V12a10 10 0 1 1-5.93-9.14'), p('m9 11 3 3L22 4')],
  'thumbs-up': [p('M7 10v12'), p('M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z')],
  'thumbs-down': [p('M17 14V2'), p('M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z')],
  'copy': [{ tag: 'rect', width: 14, height: 14, x: 8, y: 8, rx: 2 }, p('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')],
  'external-link': [p('M15 3h6v6'), p('M10 14 21 3'), p('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')],
  'eye': [p('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z'), circle(12, 12, 3)],
  'settings': [line(21, 4, 14, 4), line(10, 4, 3, 4), line(21, 12, 12, 12), line(8, 12, 3, 12), line(21, 20, 16, 20), line(12, 20, 3, 20), line(14, 2, 14, 6), line(8, 10, 8, 14), line(16, 18, 16, 22)],
  'rotate-ccw': [p('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), p('M3 3v5h5')],
  'alert-circle': [circle(12, 12, 10), line(12, 8, 12, 12), line(12, 16, 12.01, 16)],
  'wrench': [p('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z')],
  'book-open': [p('M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z'), p('M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z')],
  'rocket': [p('M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z'), p('m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z'), p('M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0'), p('M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5')],
  'map-pin': [p('M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z'), circle(12, 10, 3)],
  'user-x': [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), circle(9, 7, 4), line(17, 8, 22, 13), line(22, 8, 17, 13)],
  'list': [p('M3 6h18'), p('M7 12h10'), p('M10 18h4')],
  'users': [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), circle(9, 7, 4), p('M22 21v-2a4 4 0 0 0-3-3.87'), p('M16 3.13a4 4 0 0 1 0 7.75')],
  'sticky-note': [p('M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z'), p('M15 3v6h6')],
  'file-text': [p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4'), p('M10 9H8'), p('M16 13H8'), p('M16 17H8')],
  'lightbulb': [p('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'), p('M9 18h6'), p('M10 22h4')],
  'sprout': [p('M7 20h10'), p('M10 20c5.5-2.5.8-6.4 3-10'), p('M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z'), p('M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z')],
  'bar-chart': [p('M3 3v16a2 2 0 0 0 2 2h16'), p('M7 16V9'), p('M12 16V6'), p('M17 16v-3')],
  'dollar-sign': [line(12, 2, 12, 22), p('M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6')],
  'edit': [p('M12 20h9'), p('M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z')],
  'link': [p('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'), p('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')],
  'map': [p('M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z'), line(9, 3, 9, 18), line(15, 6, 15, 21)],
  'calculator': [{ tag: 'rect', width: 16, height: 20, x: 4, y: 2, rx: 2 }, line(8, 6, 16, 6), line(16, 14, 16, 18), p('M16 10h.01'), p('M12 10h.01'), p('M8 10h.01'), p('M12 14h.01'), p('M8 14h.01'), p('M12 18h.01'), p('M8 18h.01')]
};

/** Renders one of the Help icons by name. Unknown names render nothing. */
@Component({
  selector: 'app-help-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      @for (s of shapes(); track $index) {
        @switch (s.tag) {
          @case ('path') { <svg:path [attr.d]="s.d" /> }
          @case ('circle') { <svg:circle [attr.cx]="s.cx" [attr.cy]="s.cy" [attr.r]="s.r" /> }
          @case ('line') { <svg:line [attr.x1]="s.x1" [attr.y1]="s.y1" [attr.x2]="s.x2" [attr.y2]="s.y2" /> }
          @case ('rect') { <svg:rect [attr.x]="s.x" [attr.y]="s.y" [attr.width]="s.width" [attr.height]="s.height" [attr.rx]="s.rx" /> }
        }
      }
    </svg>
  `
})
export class HelpIconComponent {
  readonly name = input.required<string>();
  readonly size = input(16);

  readonly shapes = computed(() => ICONS[this.name()] ?? []);
}
