using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// Copies a source's customer attributes onto a tracked <see cref="Customer"/>. <c>Customer.Id</c> is
/// never touched (it is the PK / FK target).
/// </summary>
public abstract class CustomerSyncAttributes
{
    public abstract void ApplyTo(Customer target);

    public Customer CreateNew(long id)
    {
        var customer = new Customer { Id = id, IsActive = true, IsManual = false };
        ApplyTo(customer);
        return customer;
    }
}

/// <summary>
/// ODS attributes: copies every column. The body is the former <c>CustomerSyncService.ApplyAttributes</c>
/// verbatim; it accepts either ODS source (the trade-unit view or the current-customers view) through
/// the shared interface.
/// </summary>
public sealed class OdsCustomerSyncAttributes : CustomerSyncAttributes
{
    private readonly ICustomerOdsAttributes _source;

    public OdsCustomerSyncAttributes(ICustomerOdsAttributes source)
    {
        _source = source ?? throw new ArgumentNullException(nameof(source));
    }

    public override void ApplyTo(Customer target)
    {
        var source = _source;
        target.Name                  = source.CustomerName ?? string.Empty;
        target.ScoularId             = source.ScoularId;
        target.IndustryCode1         = source.IndustryCode1;
        target.IndustryCode2         = source.IndustryCode2;
        target.NopIdNumber           = OdsValues.NormaliseNopId(source.NopIdNumber);
        target.EffectiveStartDate    = source.EffectiveStartDate;
        target.EffectiveEndDate      = source.EffectiveEndDate;
        target.Phone                 = source.MerchandisingPhone;
        target.Email                 = source.MerchandisingEmail;
        target.ExtendedPrimaryPhone  = source.ExtendedPrimaryPhone;
        target.SupplementalEmail     = source.SupplementalEmail;
        target.Location              = source.MerchandisingCity;
        target.StateProvince         = source.MerchandisingStateProvince;
        target.AddressLine1          = source.MerchandisingAddressLine1;
        target.PostalCode            = source.MerchandisingPostalCode;
        target.ExtendedAddressLine1  = source.ExtendedAddressLine1;
        target.ExtendedAddressLine2  = source.ExtendedAddressLine2;
        target.ExtendedAddressLine3  = source.ExtendedAddressLine3;
        target.ExtendedAddressLine4  = source.ExtendedAddressLine4;
        target.ExtendedCity          = source.ExtendedCity;
        target.ExtendedPostalCode    = source.ExtendedPostalCode;
        target.ExtendedStateProvince = source.ExtendedStateProvince;
        target.ExtendedCountry       = source.ExtendedCountry;
    }
}

/// <summary>
/// CTRM attributes. Stage 1 (plan D10): only the nine columns the base projection carries; every column in
/// <see cref="UntouchedColumns"/> keeps its last ODS value. Extended mode (plan E1, when the lookup read the
/// extended projection under <c>CustomerSync:CtrmExtendedFields</c>): also email, supplemental email, extended
/// primary phone, the extended address and the NOP id (normalised exactly as on ODS), leaving only the effective
/// dates untouched - see <see cref="UntouchedColumnsFor"/> - plus the ctrm-only <c>PaymentMethod</c> column that
/// drives the ACH badge on the ctrm source (plan E2).
/// </summary>
/// <remarks>
/// <c>extended</c> must say what the lookup FETCHED (<c>CtrmCustomerLookup.ExtendedFields</c>), never what the
/// setting says now: applying the extended columns from a base-projection read would null every one of them.
/// </remarks>
public sealed class CtrmCustomerSyncAttributes : CustomerSyncAttributes
{
    /// <summary>Columns the ODS applier sets that the Stage 1 (base projection) CTRM applier leaves alone.</summary>
    public static readonly string[] UntouchedColumns =
    [
        "Email", "SupplementalEmail", "ExtendedPrimaryPhone",
        "ExtendedAddressLine1", "ExtendedAddressLine2", "ExtendedAddressLine3", "ExtendedAddressLine4",
        "ExtendedCity", "ExtendedPostalCode", "ExtendedStateProvince", "ExtendedCountry",
        "NopIdNumber", "EffectiveStartDate", "EffectiveEndDate",
    ];

    /// <summary>Columns the ODS applier sets that the extended CTRM applier leaves alone: no GraphQL field carries them.</summary>
    public static readonly string[] ExtendedUntouchedColumns = ["EffectiveStartDate", "EffectiveEndDate"];

    /// <summary>The untouched columns for the mode.</summary>
    public static IReadOnlyList<string> UntouchedColumnsFor(bool extended) => extended ? ExtendedUntouchedColumns : UntouchedColumns;

    private readonly CtrmCustomerDto _source;
    private readonly bool _extended;

    public CtrmCustomerSyncAttributes(CtrmCustomerDto source, bool extended = false)
    {
        _source = source ?? throw new ArgumentNullException(nameof(source));
        _extended = extended;
    }

    public override void ApplyTo(Customer target)
    {
        target.Name          = Clean(_source.Name) ?? string.Empty;
        target.ScoularId     = Clean(_source.SourceCode);
        target.Phone         = Clean(_source.MerchandisingPhone);
        target.AddressLine1  = Clean(_source.MerchandisingAddressLine1);
        target.Location      = Clean(_source.MerchandisingCity);
        target.StateProvince = Clean(_source.MerchandisingStateProvince);
        target.PostalCode    = Clean(_source.MerchandisingPostalCode);
        target.IndustryCode1 = Clean(_source.IndustryCode1);
        target.IndustryCode2 = Clean(_source.IndustryCode2);

        if (!_extended) return;

        target.Email                 = Clean(_source.MerchandisingEmail);
        target.SupplementalEmail     = Clean(_source.SupplementalEmail);
        target.ExtendedPrimaryPhone  = Clean(_source.ExtendedPrimaryPhone);
        target.ExtendedAddressLine1  = Clean(_source.ExtendedAddressLine1);
        target.ExtendedAddressLine2  = Clean(_source.ExtendedAddressLine2);
        target.ExtendedAddressLine3  = Clean(_source.ExtendedAddressLine3);
        target.ExtendedAddressLine4  = Clean(_source.ExtendedAddressLine4);
        target.ExtendedCity          = Clean(_source.ExtendedCity);
        target.ExtendedStateProvince = Clean(_source.ExtendedStateProvince);
        target.ExtendedPostalCode    = Clean(_source.ExtendedPostalCode);
        target.ExtendedCountry       = Clean(_source.ExtendedCountry);
        target.NopIdNumber           = OdsValues.NormaliseNopId(_source.NopidNoText);
        target.PaymentMethod         = PaymentMethodCode(_source.PaymentMethod);
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>
    /// The trimmed code when it fits dbo.Customer.PaymentMethod, else null. A longer value can never be the ACH
    /// code 'H', and writing it would fail the whole sync's SaveChanges with a truncation error.
    /// </summary>
    private static string? PaymentMethodCode(string? s) =>
        Clean(s) is { Length: <= Customer.PaymentMethodMaxLength } code ? code : null;
}
