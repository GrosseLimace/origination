using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Mobile.Mapping;

/// <summary>
/// The desktop contracts table's pricing rules (client/src/app/features/customers/components/contracts-table:
/// getPricingInfo, getDisplayPricingQty, getUnpricedQty), restated so the phone shows exactly what the desktop
/// shows. Keep the two in step; MobileContractPricingTests pins the cases.
/// </summary>
internal static class ContractPricing
{
    public const string Flat = "Flat";
    public const string Priced = "Priced";
    public const string Partial = "Partial";
    public const string Unpriced = "Unpriced";
    public const string Deferred = "Deferred";

    public static (string Status, decimal? CashPrice, decimal? BasisPrice) Info(ContractResponse contract, IReadOnlyList<ContractPricingLineResponse> lines)
    {
        var ptc = (contract.PriceTypeCode ?? string.Empty).Trim().ToUpperInvariant();

        // Flat pricing: the cash price from the first pricing line when there is one.
        if (ptc == "P")
            return lines.Count > 0 && lines[0].FlatPrice is { } flat ? (Flat, flat, null) : (Priced, null, null);

        if (ptc == "D")
            return (Deferred, null, null);

        if (ptc == "U" && lines.Count > 0 && lines.Any(l => (l.PriceSequence ?? 0) > 0))
        {
            var totalPriced = lines.Sum(l => l.PriceQuantity ?? 0m);
            // 1-bushel tolerance: float sums can miss the contract quantity by epsilon.
            var remaining = (contract.Quantity ?? 0m) - totalPriced;
            if (totalPriced > 0 && remaining > 1) return (Partial, null, null);
            if (remaining <= 1) return (Priced, null, null);
        }

        // A single unpriced line with a real basis: show the locked-in basis (CTRM stores "no basis yet" as 0).
        if (lines.Count == 1 && lines[0].BasisPrice is { } basis && basis != 0)
            return (Unpriced, null, basis);

        return (Unpriced, null, null);
    }

    /// <summary>A zero-quantity line covers the whole contract (single line) or the unpriced remainder (sequence 0).</summary>
    public static decimal DisplayQuantity(ContractResponse contract, ContractPricingLineResponse line, IReadOnlyList<ContractPricingLineResponse> lines)
    {
        var lineQty = line.PriceQuantity ?? 0m;
        if (lineQty != 0) return lineQty;
        if (lines.Count == 1) return contract.Quantity ?? 0m;
        if ((line.PriceSequence ?? 0) == 0)
        {
            var pricedTotal = lines.Where(l => (l.PriceSequence ?? 0) > 0).Sum(l => l.PriceQuantity ?? 0m);
            return Math.Max(0m, (contract.Quantity ?? 0m) - pricedTotal);
        }
        return 0m;
    }

    /// <summary>Bushels still to price — only for PriceTypeCode U; null for every other type.</summary>
    public static decimal? UnpricedQuantity(ContractResponse contract, IReadOnlyList<ContractPricingLineResponse> lines)
    {
        if ((contract.PriceTypeCode ?? string.Empty).Trim().ToUpperInvariant() != "U") return null;
        var totalPriced = lines.Where(l => (l.PriceSequence ?? 0) > 0).Sum(l => DisplayQuantity(contract, l, lines));
        return Math.Max(0m, (contract.Quantity ?? 0m) - totalPriced);
    }
}
