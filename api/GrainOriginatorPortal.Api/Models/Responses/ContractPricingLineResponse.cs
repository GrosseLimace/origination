namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a contract pricing line. Entity-shaped (Decision 1), including the
/// computed PricedQty / CashPrice aliases the frontend pricing badge reads.</summary>
public record ContractPricingLineResponse
{
    public string ContractId { get; init; } = string.Empty;
    public string? ContractNumber { get; init; }
    public string? CustomerName { get; init; }
    public int? PriceSequence { get; init; }
    public decimal? PriceQuantity { get; init; }
    public string? PriceUom { get; init; }
    public decimal? FlatPrice { get; init; }
    public decimal? BasisPrice { get; init; }
    public decimal? HedgePrice { get; init; }
    public DateTime? PriceDate { get; init; }
    public string? PriceCurrency { get; init; }
    public string? TraderInitials { get; init; }
    public string? Trader { get; init; }
    public decimal? PriceOpenQuantity { get; init; }
    public decimal? PriceAppliedQuantity { get; init; }
    public decimal? PriceSettledQuantity { get; init; }
    public decimal? PriceOpenWeight { get; init; }
    public decimal? PriceAppliedWeight { get; init; }
    public decimal? PriceSettledWeight { get; init; }
    public string? CustomerConfirmStatus { get; init; }
    public string? BrokerConfirmStatus { get; init; }
    public string? ConfirmationStatus { get; init; }
    public DateTime? CreatedDate { get; init; }
    public DateTime? ModifiedDate { get; init; }
    public decimal? PricedQty { get; init; }
    public decimal? CashPrice { get; init; }
}
