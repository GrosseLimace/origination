import { CheckInputs, CheckResult } from './models/calculator.model';

/**
 * Pure settlement-check computation, mirroring the "Check Calculator" sheet:
 * cash price (futures + basis) × bushels = gross, minus three deductions (check-off, delayed-price
 * carry, freight) = net check. Deductions are returned as negative numbers so total is a sum.
 * Check-off supports both modes seen in the sheet: percent-of-value and flat $/bushel.
 */
export function computeCheck(i: CheckInputs): CheckResult {
  const bushels = i.bushels || 0;
  const cashPrice = (i.futurePrice || 0) + (i.basis || 0);
  const totalBeforeFees = bushels * cashPrice;

  const daysSinceDelivery = daysBetween(i.avgDeliveryDate, i.settlementDate);
  const dailyDpFee = i.dailyDpFee || 0;   // already per-day (sheet's 0.06/30)

  // Check-off is a share of gross value in both modes (sheet: =-E10*E11). The mode only decides
  // how checkOffValue was entered: % divides the typed number by 100 (done in the component),
  // $ uses the decimal directly — both land here as a fraction of Total Before Fees.
  const totalCheckOff = -(totalBeforeFees * (i.checkOffValue || 0));

  const totalDpFees = -(daysSinceDelivery * dailyDpFee * bushels);
  const totalFreight = -((i.freightPerBushel || 0) * bushels);

  const total = totalBeforeFees + totalCheckOff + totalDpFees + totalFreight;

  return {
    cashPrice,
    totalBeforeFees,
    daysSinceDelivery,
    dailyDpFee,
    totalCheckOff,
    totalDpFees,
    totalFreight,
    total,
  };
}

/** Whole days from delivery to settlement (settlement − delivery), never negative.
 *  Both dates are ISO yyyy-MM-dd; parsed at UTC midnight so the diff is exact. */
function daysBetween(deliveryIso: string, settlementIso: string): number {
  if (!deliveryIso || !settlementIso) return 0;
  const delivery = Date.parse(`${deliveryIso}T00:00:00Z`);
  const settlement = Date.parse(`${settlementIso}T00:00:00Z`);
  if (isNaN(delivery) || isNaN(settlement)) return 0;
  const days = Math.round((settlement - delivery) / 86_400_000);
  return days > 0 ? days : 0;
}
