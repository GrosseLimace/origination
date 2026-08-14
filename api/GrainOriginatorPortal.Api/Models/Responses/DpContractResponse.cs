using System.Text.Json.Serialization;
using GrainOriginatorPortal.Infrastructure.Json;

namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Wire shape for a delayed-pricing (DP) contract position. Entity-shaped, mirroring
/// <see cref="StoredGrainResponse"/> so the DP Contracts tab and the Storage tab share a client
/// shape.
///
/// Two fields carry meaning in their nullability and must stay nullable end-to-end:
/// <see cref="Bushels"/> is null when the quantity can't be substantiated in bushels, and the date
/// fields are null when CTRM reported a "no date" sentinel. Both render blank.
/// </summary>
public record DpContractResponse
{
    public string Id { get; init; } = string.Empty;

    /// <summary>
    /// One physical delivery, shared across its charge-type rows. Count bushels once per TicketKey —
    /// every charge row repeats the same quantity. Charge amounts are additive across rows.
    /// </summary>
    public string TicketKey { get; init; } = string.Empty;
    public string TicketNumber { get; init; } = string.Empty;
    public string ContractNumber { get; init; } = string.Empty;
    public string ContractPrefixType { get; init; } = string.Empty;
    public string ContractPrefixCommodity { get; init; } = string.Empty;
    public string ContractSuffix { get; init; } = string.Empty;
    public string TicketStatus { get; init; } = string.Empty;
    public long CustomerId { get; init; }
    public string CustomerCode { get; init; } = string.Empty;
    public string TradeUnitCode { get; init; } = string.Empty;
    public string Crop { get; init; } = string.Empty;

    /// <summary>Net quantity in <see cref="QuantityUom"/> units — not necessarily bushels.</summary>
    public decimal Quantity { get; init; }
    public decimal GrossQuantity { get; init; }

    /// <summary>CTRM 2-char unit code (BU, LB, CW, TN).</summary>
    public string QuantityUom { get; init; } = string.Empty;

    /// <summary>Net quantity in bushels, or null when it can't be substantiated. Render blank when null.</summary>
    public decimal? Bushels { get; init; }

    public decimal StorageDays { get; init; }
    public decimal DecideFreeDays { get; init; }
    public decimal StorageRate { get; init; }
    public decimal ReceivableAmount { get; init; }
    public decimal PrepaidAmount { get; init; }
    public decimal UnearnedStorageAmount { get; init; }
    public decimal UnpaidHandlingAmount { get; init; }

    // Calendar dates, not timestamps. The global UtcDateTimeJsonConverter would tag these midnight
    // Kind=Unspecified values with a 'Z', and the browser would then shift them by the user's offset —
    // rendering 2023-10-09 as 10/8/23 for anyone west of UTC. CalendarDateJsonConverter writes them
    // without an offset so they land on the intended day everywhere.
    [JsonConverter(typeof(CalendarDateJsonConverter))]
    public DateTime? StorageStartDate { get; init; }
    [JsonConverter(typeof(CalendarDateJsonConverter))]
    public DateTime? ChargedFromDate { get; init; }
    [JsonConverter(typeof(CalendarDateJsonConverter))]
    public DateTime? ChargedThruDate { get; init; }
    [JsonConverter(typeof(CalendarDateJsonConverter))]
    public DateTime? PaidThruDate { get; init; }
    [JsonConverter(typeof(CalendarDateJsonConverter))]
    public DateTime? BolDate { get; init; }

    public string Status { get; init; } = string.Empty;
    public string StatusDescription { get; init; } = string.Empty;
    public string StorageProgramCode { get; init; } = string.Empty;
    public string StorageErrorFlag { get; init; } = string.Empty;
    public string StorageErrorDescription { get; init; } = string.Empty;
}
