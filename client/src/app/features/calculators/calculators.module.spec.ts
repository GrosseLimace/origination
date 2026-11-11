import { describe, it, expect } from 'vitest';
import { calculatorsModule } from './calculators.module';
import { CalculatorPanelComponent } from './components/calculator-panel.component';

describe('Calculators module: the home page launcher', () => {
  const panels = () => calculatorsModule.customerPanels ?? [];

  it('adds the launcher to the floating slot, for every customer', () => {
    expect(panels().map(p => [p.slot, p.id, p.order])).toEqual([['floating', 'calculator-launcher', 10]]);
    expect(panels()[0].segments ?? []).toEqual([]);
  });

  // The calculators read none of the user's data.
  it('asks for no permission', () => {
    expect(panels()[0].requires).toEqual([]);
  });

  it('loads as its panel', async () => {
    expect(await panels()[0].component()).toBe(CalculatorPanelComponent);
  });
});
