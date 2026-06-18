namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// The set of ODS-sourced customer attribute columns shared by the two views the
/// sync reads from — <see cref="CustomerTradeUnitView"/> (originations.vw_CustomerTradeUnits)
/// and the base.vw_CurrentCustomers row used to refresh manually-onboarded producers.
/// Lets <c>CustomerSyncService.ApplyAttributes</c> copy attributes from either source
/// without duplicating the field-by-field mapping.
/// </summary>
public interface ICustomerOdsAttributes
{
    string? CustomerName { get; }
    string? ScoularId { get; }
    string? MerchandisingPhone { get; }
    string? MerchandisingEmail { get; }
    string? ExtendedPrimaryPhone { get; }
    string? SupplementalEmail { get; }
    string? MerchandisingCity { get; }
    string? MerchandisingStateProvince { get; }
    string? MerchandisingAddressLine1 { get; }
    string? MerchandisingPostalCode { get; }
    string? ExtendedAddressLine1 { get; }
    string? ExtendedAddressLine2 { get; }
    string? ExtendedAddressLine3 { get; }
    string? ExtendedAddressLine4 { get; }
    string? ExtendedCity { get; }
    string? ExtendedStateProvince { get; }
    string? ExtendedPostalCode { get; }
    string? ExtendedCountry { get; }
    string? IndustryCode1 { get; }
    DateTime? EffectiveStartDate { get; }
    DateTime? EffectiveEndDate { get; }
}
