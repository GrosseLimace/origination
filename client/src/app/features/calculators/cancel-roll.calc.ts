import { CancelRollInputs, CancelRollResult } from './models/calculator.model';

/**
 * Pure cancel-vs-roll computation, mirroring the "Cancel-Roll Math" sheet. Two independent chains:
 *   Option 1 (Cancelation): Cost to Cancel = today − contract avg + fee; $ to Buy Out = that × bushels.
 *   Option 2 (Roll):        Cost to Roll   = today − next year + hedge;   New Cash Price = contract − roll.
 * Operator order is preserved exactly so the sign convention matches (a negative Cost to Roll is a
 * net benefit and raises the new cash price).
 */
export function computeCancelRoll(i: CancelRollInputs): CancelRollResult {
  const cashPriceToday = i.cashPriceToday || 0;

  // Option 1 — Contract Cancelation
  const costToCancel = cashPriceToday - (i.contractAvgPrice || 0) + (i.cancelFee || 0);
  const buyOut = costToCancel * (i.bushels || 0);

  // Option 2 — Roll / hold futures
  const costToRoll = cashPriceToday - (i.cashPriceNextYear || 0) + (i.hedgeCost || 0);
  const newCashPriceNextYear = (i.contractCashPrice || 0) - costToRoll;

  return { costToCancel, buyOut, costToRoll, newCashPriceNextYear };
}
