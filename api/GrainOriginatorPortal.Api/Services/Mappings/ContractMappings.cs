using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the contract domain.</summary>
public static class ContractMappings
{
    public static ContractResponse ToResponse(this Contract c) => new()
    {
        Id = c.Id,
        CustomerId = c.CustomerId,
        CtrmCustomerId = c.CtrmCustomerId,
        FarmId = c.FarmId,
        SourceContractId = c.SourceContractId,
        ContractNumber = c.ContractNumber,
        ContractPrefixType = c.ContractPrefixType,
        CustomerName = c.CustomerName,
        CommodityCode = c.CommodityCode,
        CommodityDescription = c.CommodityDescription,
        CommodityGroup = c.CommodityGroup,
        TradeUnit = c.TradeUnit,
        Quantity = c.Quantity,
        PricedQuantity = c.PricedQuantity,
        Weight = c.Weight,
        Unit = c.Unit,
        Price = c.Price,
        TotalValue = c.TotalValue,
        ContractDate = c.ContractDate,
        DeliveryStart = c.DeliveryStart,
        DeliveryEnd = c.DeliveryEnd,
        ClosedDate = c.ClosedDate,
        CropYear = c.CropYear,
        OpenBalanceQuantity = c.OpenBalanceQuantity,
        SettledQuantity = c.SettledQuantity,
        Status = c.Status,
        Signed = c.Signed,
        PriceTypeCode = c.PriceTypeCode,
        SpecialType = c.SpecialType,
        CustomerConfirmStatus = c.CustomerConfirmStatus,
        MarketZone = c.MarketZone,
        BasisLocation = c.BasisLocation,
        HedgeMarketMonthDescription = c.HedgeMarketMonthDescription,
        PriceMarketMonthDescription = c.PriceMarketMonthDescription,
        IsActive = c.IsActive,
        IsDeleted = c.IsDeleted,
        EffectiveStartDate = c.EffectiveStartDate,
        EffectiveEndDate = c.EffectiveEndDate,
    };

    public static ContractPricingLineResponse ToResponse(this ContractPricingLine p) => new()
    {
        ContractId = p.ContractId,
        ContractNumber = p.ContractNumber,
        CustomerName = p.CustomerName,
        PriceSequence = p.PriceSequence,
        PriceQuantity = p.PriceQuantity,
        PriceUom = p.PriceUom,
        FlatPrice = p.FlatPrice,
        BasisPrice = p.BasisPrice,
        HedgePrice = p.HedgePrice,
        PriceDate = p.PriceDate,
        PriceCurrency = p.PriceCurrency,
        TraderInitials = p.TraderInitials,
        Trader = p.Trader,
        PriceOpenQuantity = p.PriceOpenQuantity,
        PriceAppliedQuantity = p.PriceAppliedQuantity,
        PriceSettledQuantity = p.PriceSettledQuantity,
        PriceOpenWeight = p.PriceOpenWeight,
        PriceAppliedWeight = p.PriceAppliedWeight,
        PriceSettledWeight = p.PriceSettledWeight,
        CustomerConfirmStatus = p.CustomerConfirmStatus,
        BrokerConfirmStatus = p.BrokerConfirmStatus,
        ConfirmationStatus = p.ConfirmationStatus,
        CreatedDate = p.CreatedDate,
        ModifiedDate = p.ModifiedDate,
        PricedQty = p.PricedQty,
        CashPrice = p.CashPrice,
    };
}
