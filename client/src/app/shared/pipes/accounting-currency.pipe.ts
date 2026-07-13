import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a number as accounting-style USD: `$ 40.00` for non-negatives and `$ (40.00)` for
 * negatives (parentheses instead of a minus sign), with the `$` at the start followed by a space.
 * Optional maxFractionDigits (default 2, floored at 2) for finer values like per-bushel prices.
 */
@Pipe({ name: 'accountingCurrency', standalone: true })
export class AccountingCurrencyPipe implements PipeTransform {
  transform(value: number | null | undefined, maxFractionDigits = 2): string {
    const n = Number(value) || 0;
    const abs = Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: Math.max(2, maxFractionDigits),
    });
    return n < 0 ? `$ (${abs})` : `$ ${abs}`;
  }
}
