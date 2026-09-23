using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>Row shape for the base.vw_CurrentCustomers read in the manual-producer refresh pass.
/// Property names match the selected columns so EF's SqlQueryRaw can bind them, and it implements
/// <see cref="ICustomerOdsAttributes"/> so the sync can reuse its attribute-copy helper.</summary>
public sealed class CurrentCustomerRow : ICustomerOdsAttributes
{
    public long CustomerId { get; set; }
    public string? ScoularId { get; set; }
    public string? CustomerName { get; set; }
    public string? IndustryCode1 { get; set; }
    public string? IndustryCode2 { get; set; }
    public string? NopIdNumber { get; set; }
    public string? MerchandisingCity { get; set; }
    public string? MerchandisingStateProvince { get; set; }
    public string? MerchandisingAddressLine1 { get; set; }
    public string? MerchandisingPostalCode { get; set; }
    public string? MerchandisingPhone { get; set; }
    public string? MerchandisingEmail { get; set; }
    public string? ExtendedPrimaryPhone { get; set; }
    public string? SupplementalEmail { get; set; }
    public string? ExtendedAddressLine1 { get; set; }
    public string? ExtendedAddressLine2 { get; set; }
    public string? ExtendedAddressLine3 { get; set; }
    public string? ExtendedAddressLine4 { get; set; }
    public string? ExtendedCity { get; set; }
    public string? ExtendedPostalCode { get; set; }
    public string? ExtendedStateProvince { get; set; }
    public string? ExtendedCountry { get; set; }
    public DateTime? EffectiveStartDate { get; set; }
    public DateTime? EffectiveEndDate { get; set; }
}
