namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Read-only projection of originations.vw_CustomerTradeUnits in ODS — each row is a
/// customer paired with one trade unit they're active in (via contracts or tickets).
/// Used by the customer-data sync (DiagnosticsController populate endpoint) and by
/// UserEntitlementService.ValidateCustomerAccessAsync.
///
/// Not to be confused with the app-DB entity <see cref="CustomerTradeUnit"/> which is
/// the materialized join table for the per-customer per-TU memberships.
/// </summary>
public class CustomerTradeUnitView : ICustomerOdsAttributes
{
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string? ScoularId { get; set; }
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
    public string? ExtendedStateProvince { get; set; }
    public string? ExtendedPostalCode { get; set; }
    public string? ExtendedCountry { get; set; }
    public string? IndustryCode1 { get; set; }
    public bool IsActive { get; set; }
    public DateTime? EffectiveStartDate { get; set; }
    public DateTime? EffectiveEndDate { get; set; }
    public string? TradeUnit { get; set; }

    public Customer ToCustomer() => new Customer
    {
        Id = CustomerId,
        Name = CustomerName ?? string.Empty,
        ScoularId = ScoularId,
        Phone = MerchandisingPhone,
        Email = MerchandisingEmail,
        ExtendedPrimaryPhone = ExtendedPrimaryPhone,
        SupplementalEmail = SupplementalEmail,
        Location = MerchandisingCity,
        StateProvince = MerchandisingStateProvince,
        AddressLine1 = MerchandisingAddressLine1,
        PostalCode = MerchandisingPostalCode,
        ExtendedAddressLine1 = ExtendedAddressLine1,
        ExtendedAddressLine2 = ExtendedAddressLine2,
        ExtendedAddressLine3 = ExtendedAddressLine3,
        ExtendedAddressLine4 = ExtendedAddressLine4,
        ExtendedCity = ExtendedCity,
        ExtendedStateProvince = ExtendedStateProvince,
        ExtendedPostalCode = ExtendedPostalCode,
        ExtendedCountry = ExtendedCountry,
        IndustryCode1 = IndustryCode1,
        IsActive = IsActive,
        EffectiveStartDate = EffectiveStartDate,
        EffectiveEndDate = EffectiveEndDate,
    };
}
