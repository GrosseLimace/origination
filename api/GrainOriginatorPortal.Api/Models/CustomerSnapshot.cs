namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Materialized snapshot of originations.vw_CustomerTradeUnits stored in the Origination DB.
/// One row per customer-trade unit pair. Populated on-demand via POST /api/diagnostics/customer-snapshot/populate.
/// </summary>
public class CustomerSnapshot
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? SourceCustomerId { get; set; }
    public string? IndustryCode1 { get; set; }
    public bool IsActive { get; set; }
    public DateTime? EffectiveStartDate { get; set; }
    public DateTime? EffectiveEndDate { get; set; }
    public string? MerchandisingPhone { get; set; }
    public string? MerchandisingEmail { get; set; }
    public string? ExtendedPrimaryPhone { get; set; }
    public string? SupplementalEmail { get; set; }
    public string? MerchandisingCity { get; set; }
    public string? MerchandisingStateProvince { get; set; }
    public string? MerchandisingAddressLine1 { get; set; }
    public string? MerchandisingPostalCode { get; set; }
    public string? ExtendedAddressLine1 { get; set; }
    public string? ExtendedAddressLine2 { get; set; }
    public string? ExtendedAddressLine3 { get; set; }
    public string? ExtendedAddressLine4 { get; set; }
    public string? ExtendedCity { get; set; }
    public string? ExtendedPostalCode { get; set; }
    public string? ExtendedStateProvince { get; set; }
    public string? ExtendedCountry { get; set; }
    public string? TradeUnit { get; set; }
    public DateTime SnapshotRefreshedAt { get; set; }
}
