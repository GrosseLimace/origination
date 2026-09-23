using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the stored-grain domain.</summary>
public static class StoredGrainMappings
{
    public static StoredGrainResponse ToResponse(this StoredGrain g) => new()
    {
        Id = g.Id,
        ReceiptNumber = g.ReceiptNumber,
        CustomerId = g.CustomerId,
        CustomerCode = g.CustomerCode,
        Crop = g.Crop,
        Quantity = g.Quantity,
        GrossQuantity = g.GrossQuantity,
        StorageStartDate = g.StorageStartDate,
        StorageRate = g.StorageRate,
        Bin = g.Bin,
        ReceivableAmount = g.ReceivableAmount,
        StorageDays = g.StorageDays,
        ChargedFromDate = g.ChargedFromDate,
        ChargedThruDate = g.ChargedThruDate,
        LocationCity = g.LocationCity,
        LocationState = g.LocationState,
        Bushels = g.Bushels,
        DateReceived = g.DateReceived,
    };
}
