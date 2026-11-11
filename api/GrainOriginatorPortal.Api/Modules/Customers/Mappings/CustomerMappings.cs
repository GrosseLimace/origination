using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Interfaces;
using GrainOriginatorPortal.Api.Modules.Customers.Models.Responses;

namespace GrainOriginatorPortal.Api.Modules.Customers.Mappings;

/// <summary>Manual entity → response mappings for the customer domain.</summary>
public static class CustomerMappings
{
    public static CustomerResponse ToResponse(this Customer c) => new()
    {
        Id = c.Id,
        ScoularId = c.ScoularId,
        CustomerCode = c.CustomerCode,
        Name = c.Name,
        Location = c.Location,
        StateProvince = c.StateProvince,
        AddressLine1 = c.AddressLine1,
        PostalCode = c.PostalCode,
        Phone = c.Phone,
        Email = c.Email,
        ExtendedPrimaryPhone = c.ExtendedPrimaryPhone,
        SupplementalEmail = c.SupplementalEmail,
        ExtendedAddressLine1 = c.ExtendedAddressLine1,
        ExtendedAddressLine2 = c.ExtendedAddressLine2,
        ExtendedAddressLine3 = c.ExtendedAddressLine3,
        ExtendedAddressLine4 = c.ExtendedAddressLine4,
        ExtendedCity = c.ExtendedCity,
        ExtendedPostalCode = c.ExtendedPostalCode,
        ExtendedStateProvince = c.ExtendedStateProvince,
        ExtendedCountry = c.ExtendedCountry,
        ESignEnabled = c.ESignEnabled,
        AchEnabled = c.AchEnabled,
        ActiveTradeUnits = c.ActiveTradeUnits,
        ScoularViewRecipients = c.ScoularViewRecipients,
        Guild = c.Guild,
        Coordinates = c.Coordinates is null ? null : new CoordinatesResponse { Lat = c.Coordinates.Lat, Lng = c.Coordinates.Lng },
        IndustryCode1 = c.IndustryCode1,
        IndustryCode2 = c.IndustryCode2,
        NopId = c.NopIdNumber,
        IsActive = c.IsActive,
        EffectiveStartDate = c.EffectiveStartDate,
        EffectiveEndDate = c.EffectiveEndDate,
        IsManual = c.IsManual,
    };

    public static CustomerTradeUnitInfo ToInfo(this CustomerTradeUnitMembership m) => new()
    {
        TradeUnit = m.TradeUnit,
        IsManual = m.IsManual,
        HasOpenActivity = m.HasOpenActivity,
        IsActive = m.IsActive,
    };
}
