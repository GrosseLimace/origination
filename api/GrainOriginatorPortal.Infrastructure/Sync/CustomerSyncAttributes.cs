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
/// CTRM attributes: only the nine columns GraphQL carries today (Stage 1). Every column in
/// <see cref="UntouchedColumns"/> keeps its last ODS value until the API exposes the field.
/// </summary>
public sealed class CtrmCustomerSyncAttributes : CustomerSyncAttributes
{
    public static readonly string[] UntouchedColumns =
    [
        "Email", "SupplementalEmail", "ExtendedPrimaryPhone",
        "ExtendedAddressLine1", "ExtendedAddressLine2", "ExtendedAddressLine3", "ExtendedAddressLine4",
        "ExtendedCity", "ExtendedPostalCode", "ExtendedStateProvince", "ExtendedCountry",
        "NopIdNumber", "EffectiveStartDate", "EffectiveEndDate",
    ];

    private readonly CtrmCustomerDto _source;

    public CtrmCustomerSyncAttributes(CtrmCustomerDto source)
    {
        _source = source ?? throw new ArgumentNullException(nameof(source));
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
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
