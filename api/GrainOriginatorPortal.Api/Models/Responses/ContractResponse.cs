using System.Text.Json.Serialization;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Json;

namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a purchase contract. Entity-shaped (Decision 1); the four calendar
/// dates keep the date-only converter so they serialize without a UTC 'Z' / day shift.</summary>
public record ContractResponse
{
    public long Id { get; init; }
    public long? CustomerId { get; init; }
    public string? CtrmCustomerId { get; init; }
    public string FarmId { get; init; } = string.Empty;
    public string? SourceContractId { get; init; }
    public string ContractNumber { get; init; } = string.Empty;
    public string? ContractPrefixType { get; init; }
    public string? CustomerName { get; init; }
    public string? CommodityCode { get; init; }
    public string? CommodityDescription { get; init; }
    public string? CommodityGroup { get; init; }
    public string? TradeUnit { get; init; }
    public decimal? Quantity { get; init; }
    public decimal? PricedQuantity { get; init; }
    public decimal? Weight { get; init; }
    public string? Unit { get; init; }
    public decimal? Price { get; init; }
    public decimal? TotalValue { get; init; }

    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? ContractDate { get; init; }
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? DeliveryStart { get; init; }
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? DeliveryEnd { get; init; }
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? ClosedDate { get; init; }

    public int? CropYear { get; init; }
    public decimal? OpenBalanceQuantity { get; init; }
    public decimal? SettledQuantity { get; init; }
    public ContractStatus Status { get; init; } = ContractStatus.Pending;
    public bool Signed { get; init; }
    public string? PriceTypeCode { get; init; }
    public string? SpecialType { get; init; }
    public string? CustomerConfirmStatus { get; init; }
    public string? MarketZone { get; init; }
    public string? BasisLocation { get; init; }
    public string? HedgeMarketMonthDescription { get; init; }
    public string? PriceMarketMonthDescription { get; init; }
    public bool IsActive { get; init; }
    public bool IsDeleted { get; init; }
    public DateTime? EffectiveStartDate { get; init; }
    public DateTime? EffectiveEndDate { get; init; }
}
