import { describe, it, expect } from 'vitest';
import { inSelectedTradeUnits } from './planting-trade-unit-filter';

// A producer on Pratt (2190) and Tribune (2210): their Pratt soybeans must not count on
// Tribune's dashboard.
describe('inSelectedTradeUnits', () => {
  const pratt = new Set(['2190']);
  const both = new Set(['2190', '2210']);

  it('counts a row only under its own trade unit', () => {
    expect(inSelectedTradeUnits({ tradeUnit: '2190' }, pratt)).toBe(true);
    expect(inSelectedTradeUnits({ tradeUnit: '2210' }, pratt)).toBe(false);
  });

  it('counts a row once when both of its producer\'s trade units are selected', () => {
    expect(inSelectedTradeUnits({ tradeUnit: '2190' }, both)).toBe(true);
    expect(inSelectedTradeUnits({ tradeUnit: '2210' }, both)).toBe(true);
  });

  it('lets a legacy blank-tagged row through (falls back to producer membership)', () => {
    expect(inSelectedTradeUnits({ tradeUnit: '' }, pratt)).toBe(true);
    expect(inSelectedTradeUnits({ tradeUnit: '  ' }, pratt)).toBe(true);
    expect(inSelectedTradeUnits({ tradeUnit: undefined }, pratt)).toBe(true);
    expect(inSelectedTradeUnits({ tradeUnit: null }, pratt)).toBe(true);
  });

  it('does not filter when no trade units are in scope', () => {
    expect(inSelectedTradeUnits({ tradeUnit: '2210' }, new Set())).toBe(true);
  });

  it('ignores surrounding whitespace on the row tag', () => {
    expect(inSelectedTradeUnits({ tradeUnit: ' 2190 ' }, pratt)).toBe(true);
  });

  it('excludes a row tagged to a trade unit the producer has left (until re-tagged)', () => {
    // Producer now only on Pratt; the row still says Tribune → counts nowhere.
    expect(inSelectedTradeUnits({ tradeUnit: '2210' }, pratt)).toBe(false);
  });
});
