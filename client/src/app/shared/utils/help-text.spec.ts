import { describe, it, expect } from 'vitest';
import { splitHelpText } from './help-text';

describe('splitHelpText', () => {
  it('returns one plain segment for text without markers', () => {
    expect(splitHelpText('Press Retry in a moment.')).toEqual([{ text: 'Press Retry in a moment.', bold: false }]);
  });

  it('alternates plain and bold around each pair of markers', () => {
    expect(splitHelpText('Open **Build a List**, then **Save List**.')).toEqual([
      { text: 'Open ', bold: false },
      { text: 'Build a List', bold: true },
      { text: ', then ', bold: false },
      { text: 'Save List', bold: true },
      { text: '.', bold: false }
    ]);
  });

  it('drops the empty pieces left by a marker at the start or end', () => {
    expect(splitHelpText('**Retry**')).toEqual([{ text: 'Retry', bold: true }]);
  });

  it('keeps angle brackets as literal text — segments are bound as text, never HTML', () => {
    expect(splitHelpText('**<b>x</b>**')).toEqual([{ text: '<b>x</b>', bold: true }]);
  });
});
