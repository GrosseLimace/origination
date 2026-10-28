import type { HelpTextSegment } from '@models';

/**
 * Splits help answer text into plain and bold segments on its `**` markers.
 *
 * This is the only formatting help text supports, and it is deliberately not markdown: the segments
 * are bound into the template as text (`{{ }}`), so nothing in the content file is ever interpreted
 * as HTML. The API test suite keeps the markers balanced; an unbalanced one would simply bold the
 * rest of the sentence.
 */
export function splitHelpText(text: string): HelpTextSegment[] {
  return text
    .split('**')
    .map((piece, index) => ({ text: piece, bold: index % 2 === 1 }))
    .filter(segment => segment.text.length > 0);
}
