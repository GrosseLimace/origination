namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Commodity conversion factors from ctrm.vw_GNP024.
/// Pounds_To_Commodity_Unit is the lbs-per-bushel (or per-unit) factor.
/// Bushels = Pounds / LbsPerUnit.
/// </summary>
public class CommodityConversion
{
    public string CommodityCode { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal LbsPerUnit { get; set; }
    public string? UnitOfMeasure { get; set; }
}
