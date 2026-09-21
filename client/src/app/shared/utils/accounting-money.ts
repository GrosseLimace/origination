/**
 * Accounting-style USD: `$ 40.00` for non-negatives, `$ (40.00)` for negatives (parentheses
 * rather than a minus sign), `$` first followed by a space. `maxFractionDigits` is floored at 2
 * so finer values like per-bushel prices can show more precision without ever showing less.
 *
 * Single source for both surfaces that format money this way: the on-screen
 * `AccountingCurrencyPipe` and `reportMoneyAccounting` in the calculator report builder. Those two
 * held byte-for-byte identical copies — the report one's own doc comment noted it was matching the
 * pipe, which is exactly the kind of acknowledged duplication that drifts the first time someone
 * changes only one of them.
 */
export function formatAccountingMoney(
  value: number | null | undefined,
  maxFractionDigits = 2,
): string {
  const n = Number(value) || 0;
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(2, maxFractionDigits),
  });
  return n < 0 ? `$ (${abs})` : `$ ${abs}`;
}
