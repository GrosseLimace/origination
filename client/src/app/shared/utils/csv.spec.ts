import { describe, it, expect } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('should quote commas, quotes, line breaks and edge spaces (RFC 4180)', () => {
    expect(csvCell('PRATT, KS')).toBe('"PRATT, KS"');
    expect(csvCell('6" auger')).toBe('"6"" auger"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded')).toBe('" padded"');
    expect(csvCell('TATOB43')).toBe('TATOB43');
  });

  it('should defuse text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
  });

  it('should write numbers as numbers, even negative, and blanks as empty', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(3070.75)).toBe('3070.75');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(true)).toBe('Y');
  });
});

describe('toCsv', () => {
  it('should write a header and one CRLF line per row', () => {
    expect(toCsv(['Ticket #', 'Net bushels'], [['P1', 1000], ['P2', 500.5]])).toBe('Ticket #,Net bushels\r\nP1,1000\r\nP2,500.5\r\n');
  });
});
