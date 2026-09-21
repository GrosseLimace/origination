import { Pipe, PipeTransform } from '@angular/core';
import { formatAccountingMoney } from '@shared/utils/accounting-money';

/**
 * Template-facing wrapper over {@link formatAccountingMoney}: accounting-style USD, `$ 40.00` for
 * non-negatives and `$ (40.00)` for negatives. The formatting itself is shared with the calculator
 * report builder so the printed report and the screen can't drift apart.
 */
@Pipe({ name: 'accountingCurrency', standalone: true })
export class AccountingCurrencyPipe implements PipeTransform {
  transform(value: number | null | undefined, maxFractionDigits = 2): string {
    return formatAccountingMoney(value, maxFractionDigits);
  }
}
