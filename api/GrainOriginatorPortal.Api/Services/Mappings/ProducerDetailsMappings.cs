using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the producer-details domain.</summary>
public static class ProducerDetailsMappings
{
    public static ProducerDetailsResponse ToResponse(this ProducerDetails p, IReadOnlyDictionary<string, string> nameMap) => new()
    {
        Id = p.Id,
        CustomerId = p.CustomerId,
        ScoularId = p.ScoularId,
        CustomerName = p.CustomerName,
        TotalAcres = p.TotalAcres,
        BinCapacity = p.BinCapacity,
        PrimaryContact = p.PrimaryContact,
        PrimaryPhone = p.PrimaryPhone,
        Commodities = p.Commodities,
        LinkedProducerIds = p.LinkedProducerIds,
        CreatedBy = DisplayNames.Apply(p.CreatedBy, nameMap),
        CreatedAt = p.CreatedAt,
        ModifiedBy = string.IsNullOrEmpty(p.ModifiedBy) ? p.ModifiedBy : DisplayNames.Apply(p.ModifiedBy, nameMap),
        ModifiedAt = p.ModifiedAt,
        GrainOnFarm = p.GrainOnFarm.Select(g => new GrainOnFarmItemResponse
        {
            CommodityCode = g.CommodityCode,
            BushelsOnHand = g.BushelsOnHand,
            TargetBushels = g.TargetBushels,
            Grade = g.Grade,
        }).ToList(),
        // Repository composes contacts primary-first; keep that order on the wire.
        Contacts = p.Contacts.Select(c => new ContactItemResponse
        {
            Name = c.Name,
            Phone = c.Phone,
            Email = c.Email,
            IsPrimary = c.IsPrimary,
            SortOrder = c.SortOrder,
        }).ToList(),
        BinSites = p.BinSites.Select(b => new BinSiteItemResponse
        {
            Name = b.Name,
            Latitude = b.Latitude,
            Longitude = b.Longitude,
            Capacity = b.Capacity,
            SortOrder = b.SortOrder,
        }).ToList(),
    };
}
