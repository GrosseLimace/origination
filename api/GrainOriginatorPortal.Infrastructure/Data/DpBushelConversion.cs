namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Converts a DP-contract quantity to bushels. Kept as a pure static so the unit branches are
/// testable without a database.
///
/// The DP report (<c>ctrm.vw_GNTA70D1</c>) reports quantity in whatever unit <c>Quantity_Uom</c>
/// names — a <c>char(2)</c> CTRM unit code — while every screen in the portal displays bushels.
/// Conversion factors come from <c>ctrm.vw_GNP024</c> (<c>CommodityConversion.LbsPerUnit</c> =
/// pounds per bushel for that commodity).
///
/// The governing rule is <b>never display a bushel figure we cannot substantiate</b>: an
/// unrecognized or blank unit code, or a commodity with no conversion factor, yields <c>null</c>
/// so the UI renders a blank rather than a number that would silently be wrong by orders of
/// magnitude. Do not add a "close enough" fallback here.
/// </summary>
public static class DpBushelConversion
{
    /// <summary>Pounds in a hundredweight.</summary>
    private const decimal PoundsPerHundredweight = 100m;

    /// <summary>Pounds in a short ton.</summary>
    private const decimal PoundsPerTon = 2000m;

    /// <summary>
    /// Converts <paramref name="quantity"/> (expressed in <paramref name="quantityUom"/>) to bushels.
    /// </summary>
    /// <param name="quantity">Quantity in the report's own unit.</param>
    /// <param name="quantityUom">CTRM 2-char unit code — BU, LB, CW, or TN. Case/padding insensitive.</param>
    /// <param name="commodityCode">CTRM commodity code, used to look up pounds-per-bushel.</param>
    /// <param name="lbsPerBushelByCommodity">Commodity code (trimmed, upper-cased) → pounds per bushel.</param>
    /// <returns>Bushels, or <c>null</c> when the figure cannot be substantiated.</returns>
    public static decimal? ToBushels(
        decimal quantity,
        string? quantityUom,
        string? commodityCode,
        IReadOnlyDictionary<string, decimal> lbsPerBushelByCommodity)
    {
        var uom = (quantityUom ?? string.Empty).Trim().ToUpperInvariant();
        if (uom.Length == 0) return null;

        // Already bushels — no factor needed, so this path works even for commodities missing from
        // the conversion view.
        if (uom is "BU") return quantity;

        var pounds = uom switch
        {
            "LB" => quantity,
            "CW" => quantity * PoundsPerHundredweight,
            "TN" => quantity * PoundsPerTon,
            _ => (decimal?)null,
        };
        if (pounds is null) return null;

        var code = (commodityCode ?? string.Empty).Trim().ToUpperInvariant();
        if (code.Length == 0) return null;
        if (!lbsPerBushelByCommodity.TryGetValue(code, out var lbsPerBushel) || lbsPerBushel <= 0) return null;

        return pounds.Value / lbsPerBushel;
    }

    /// <summary>
    /// Normalizes a CTRM "no date" sentinel to <c>null</c>. The DP view declares every date column
    /// NOT NULL, so an absent date arrives as a floor value (0001-01-01 from the AS/400, or
    /// 1900-01-01 from the ODS load) rather than as NULL. Rendering those verbatim would put
    /// "1/1/01" in front of an originator.
    /// </summary>
    public static DateTime? NullIfSentinel(DateTime value) => value.Year <= 1900 ? null : value;
}
