namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Minimal read-only projection of base.ContractPrice — just the key needed to match a pricing line
/// (SourceContractId + PriceSequence) plus FreightAdjustment. The curated pricing rows still come from
/// base.vw_ContractPricing; this enriches them with FreightAdjustment, which the view does not surface.
/// </summary>
public class ContractPriceFreightAdjustment
{
    public string? SourceContractId { get; set; }
    public int? PriceSequence { get; set; }
    public decimal? FreightAdjustment { get; set; }
}
