using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Mobile.Contracts;

namespace GrainOriginatorPortal.Mobile.Mapping;

/// <summary>
/// Projections from the Application layer's responses onto the deliberately narrower mobile DTOs.
/// Anything not mapped here does not leave the API on the mobile surface.
/// </summary>
internal static class MobileMappings
{
    public static CustomerSummaryDto ToSummary(this CustomerResponse c, string? tradeUnit = null) => new()
    {
        Id = c.Id,
        ScoularId = c.ScoularId,
        Name = c.Name,
        Location = JoinNonEmpty(", ", c.ExtendedCity ?? c.Location, c.ExtendedStateProvince ?? c.StateProvince),
        TradeUnit = tradeUnit,
    };

    public static CustomerDetailDto ToDetail(this CustomerResponse c, IReadOnlyList<ContactDto> contacts, string? tradeUnit) => new()
    {
        Id = c.Id,
        ScoularId = c.ScoularId,
        Name = c.Name,
        Farm = string.IsNullOrWhiteSpace(c.Farm) ? null : c.Farm,
        AddressLine1 = c.ExtendedAddressLine1 ?? c.AddressLine1,
        City = c.ExtendedCity ?? c.Location,
        StateProvince = c.ExtendedStateProvince ?? c.StateProvince,
        PostalCode = c.ExtendedPostalCode ?? c.PostalCode,
        TradeUnit = tradeUnit,
        ESignEnabled = c.ESignEnabled,
        // The desktop profile's rule: phone, else extended primary phone; email, else supplemental email.
        Phone = FirstNonEmpty(c.Phone, c.ExtendedPrimaryPhone),
        Email = FirstNonEmpty(c.Email, c.SupplementalEmail),
        Contacts = contacts,
    };

    private static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

    public static ContactDto ToContact(this ContactItemResponse c) => new()
    {
        Name = c.Name,
        Phone = c.Phone,
        Email = c.Email,
        IsPrimary = c.IsPrimary,
    };

    public static ProducerDetailsDto ToProducerDetails(this ProducerDetailsResponse d) => new()
    {
        CustomerId = d.CustomerId,
        TotalAcres = d.TotalAcres,
        BinSites = d.BinSites
            .OrderBy(s => s.SortOrder)
            .Select(s => new BinSiteDto
            {
                SiteKey = s.SiteKey,
                Name = s.Name ?? string.Empty,
                Capacity = s.Capacity,
                Latitude = s.Latitude,
                Longitude = s.Longitude,
            })
            .ToList(),
        TotalBinCapacity = d.BinSites.Any(s => s.Capacity.HasValue) ? d.BinSites.Sum(s => s.Capacity ?? 0m) : null,
        // Every field round-trips (key, last bid included) so the phone can send the list back whole.
        GrainOnFarm = d.GrainOnFarm.Select(g => new GrainOnFarmItemDto
        {
            BinSiteKey = g.BinSiteKey,
            BinSiteName = g.BinSiteName,
            CommodityCode = g.CommodityCode,
            BushelsOnHand = g.BushelsOnHand,
            BushelsSold = g.BushelsSold,
            TargetBushels = g.TargetBushels,
            LastBid = g.LastBid,
            Grade = g.Grade,
        }).ToList(),
        ModifiedBy = d.ModifiedBy ?? d.CreatedBy,
        ModifiedAt = d.ModifiedAt ?? d.CreatedAt,
    };

    public static NoteDto ToNote(this NoteResponse n) => new()
    {
        Id = n.Id,
        CustomerId = n.CustomerId,
        Subject = n.Subject,
        Content = string.IsNullOrEmpty(n.Content) ? n.Description : n.Content,
        CreatedBy = n.CreatedBy,
        CreatedAt = n.CreatedAt,
        IsPinned = n.IsPinned,
    };

    /// <param name="lines">This contract's pricing lines, in the order the API returns them (the desktop reads them so).</param>
    public static ContractCardDto ToCard(this ContractResponse c, IReadOnlyList<ContractPricingLineResponse> lines)
    {
        var (status, cash, basis) = ContractPricing.Info(c, lines);
        return new ContractCardDto
        {
            Id = c.Id,
            ContractNumber = c.ContractNumber,
            SourceContractId = c.SourceContractId,
            CommodityCode = c.CommodityCode,
            CommodityDescription = c.CommodityDescription,
            Quantity = c.Quantity,
            Unit = c.Unit,
            Price = c.Price,
            PriceTypeCode = c.PriceTypeCode,
            ContractDate = c.ContractDate,
            DeliveryStart = c.DeliveryStart,
            DeliveryEnd = c.DeliveryEnd,
            SpecialType = c.SpecialType,
            Status = c.Status.ToString(),
            OpenBalanceQuantity = c.OpenBalanceQuantity,
            SettledQuantity = c.SettledQuantity,
            Signed = c.Signed,
            CustomerConfirmStatus = c.CustomerConfirmStatus,
            PricingStatus = status,
            CashPrice = cash,
            BasisPrice = basis,
        };
    }

    public static ContractDetailDto ToDetail(this ContractResponse c, IReadOnlyList<ContractPricingLineResponse> lines)
    {
        var card = c.ToCard(lines);
        return new ContractDetailDto
        {
            Id = card.Id,
            ContractNumber = card.ContractNumber,
            SourceContractId = card.SourceContractId,
            CommodityCode = card.CommodityCode,
            CommodityDescription = card.CommodityDescription,
            Quantity = card.Quantity,
            Unit = card.Unit,
            Price = card.Price,
            PriceTypeCode = card.PriceTypeCode,
            ContractDate = card.ContractDate,
            DeliveryStart = card.DeliveryStart,
            DeliveryEnd = card.DeliveryEnd,
            SpecialType = card.SpecialType,
            Status = card.Status,
            OpenBalanceQuantity = card.OpenBalanceQuantity,
            SettledQuantity = card.SettledQuantity,
            Signed = card.Signed,
            CustomerConfirmStatus = card.CustomerConfirmStatus,
            PricingStatus = card.PricingStatus,
            CashPrice = card.CashPrice,
            BasisPrice = card.BasisPrice,
            CropYear = c.CropYear,
            PricedQuantity = c.PricedQuantity,
            UnpricedQuantity = ContractPricing.UnpricedQuantity(c, lines),
            BasisLocation = c.BasisLocation,
            MarketZone = c.MarketZone,
            HedgeMarketMonth = c.HedgeMarketMonthDescription ?? c.PriceMarketMonthDescription,
            PricingLines = lines.OrderBy(l => l.PriceSequence ?? int.MaxValue).Select(l => new PricingLineDto
            {
                Sequence = l.PriceSequence,
                Quantity = ContractPricing.DisplayQuantity(c, l, lines),
                Price = l.FlatPrice ?? l.CashPrice,
                FlatPrice = l.FlatPrice,
                BasisPrice = l.BasisPrice,
                HedgePrice = l.HedgePrice,
                FreightAdjustment = l.FreightAdjustment,
                PriceDate = l.PriceDate,
                Status = l.CustomerConfirmStatus,
                MarketMonth = null,
            }).ToList(),
        };
    }

    public static PlantingIntentionDto ToDto(this PlantingIntentionResponse p) => new()
    {
        Id = p.Id,
        CustomerId = p.CustomerId,
        PlantingYear = p.PlantingYear,
        Crop = p.Crop,
        Type = string.IsNullOrWhiteSpace(p.Type) ? null : p.Type,
        Acres = p.Acres,
        TradeUnit = p.TradeUnit,
        ModifiedAt = p.ModifiedAt ?? p.CreatedAt,
    };

    public static StorageCardDto ToCard(this StoredGrainResponse s) => new()
    {
        Id = s.Id,
        ReceiptNumber = s.ReceiptNumber,
        Crop = s.Crop,
        Bushels = s.Bushels,
        LocationCity = NullIfEmpty(s.LocationCity),
        LocationState = NullIfEmpty(s.LocationState),
        StorageStartDate = s.StorageStartDate,
        StorageRate = s.StorageRate,
        ReceivableAmount = s.ReceivableAmount,
        StorageDays = s.StorageDays,
        ChargedFromDate = s.ChargedFromDate,
        ChargedThruDate = s.ChargedThruDate,
    };

    public static CommodityDto ToDto(this CommodityResponse c) => new()
    {
        Code = c.Code,
        Name = c.Name,
        PlantingCategory = c.PlantingCategory ?? c.Category,
    };

    private static string? JoinNonEmpty(string separator, params string?[] parts)
    {
        var joined = string.Join(separator, parts.Where(p => !string.IsNullOrWhiteSpace(p)));
        return joined.Length == 0 ? null : joined;
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
