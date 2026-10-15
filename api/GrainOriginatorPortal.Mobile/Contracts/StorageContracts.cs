namespace GrainOriginatorPortal.Mobile.Contracts;

/// <summary>Schema <c>StorageCard</c> (card #648): one warehouse receipt (the storage contract).</summary>
public sealed record StorageCardDto
{
    public required string Id { get; init; }
    public required string ReceiptNumber { get; init; }
    public required string Crop { get; init; }
    public required decimal Bushels { get; init; }
    public string? LocationCity { get; init; }
    public string? LocationState { get; init; }
    public DateTime? StorageStartDate { get; init; }
    public decimal? StorageRate { get; init; }
    public decimal? ReceivableAmount { get; init; }

    /// <summary>Days charged, as the desktop's "Days" column.</summary>
    public decimal? StorageDays { get; init; }
    public DateTime? ChargedFromDate { get; init; }
    public DateTime? ChargedThruDate { get; init; }
}

/// <summary>
/// Schema <c>DpContractCard</c> (card #648): one DP contract, rolled up from its delivery charge rows the
/// desktop's way (<c>dp-aggregate.ts</c>): tickets = distinct deliveries, bushels counted once per delivery,
/// charges summed across every charge row. No ticket-level detail (the card says count + bushels is enough).
/// DP data exists only in Prod ODS; Dev/QA return empty.
/// </summary>
public sealed record DpContractCardDto
{
    public required string Id { get; init; }

    /// <summary>"No contract" when the rows carry none (the desktop's fallback).</summary>
    public required string ContractNumber { get; init; }
    public required string Crop { get; init; }

    /// <summary>Distinct deliveries (tickets) applied to the contract — not the charge-row count.</summary>
    public required int TicketCount { get; init; }

    /// <summary>Bushels counted once per delivery; null when no delivery could be converted to bushels.</summary>
    public decimal? Bushels { get; init; }

    /// <summary>Deliveries whose quantity could not be converted, so they are missing from <see cref="Bushels"/>.</summary>
    public required int UnconvertedCount { get; init; }

    /// <summary>Accumulated charges owed, summed across every charge row.</summary>
    public required decimal Charges { get; init; }

    /// <summary>Charges ÷ bushels in dollars per bushel (the desktop shows it as ¢/bu); null without bushels.</summary>
    public decimal? ChargesPerBushel { get; init; }

    /// <summary>Earliest charged-from (else storage-start) date — the desktop's "Since".</summary>
    public DateTime? Since { get; init; }
    public DateTime? ChargedThruDate { get; init; }
    public DateTime? PaidThruDate { get; init; }

    /// <summary>Charges by type (e.g. INITIAL CHARGE, REGULAR STG RATE), largest first.</summary>
    public required List<DpChargeDto> ChargeBreakdown { get; init; }
}

/// <summary>Schema <c>DpCharge</c>: one charge type's total on a DP contract.</summary>
public sealed record DpChargeDto
{
    public required string Description { get; init; }
    public required decimal Amount { get; init; }

    /// <summary>The rate when every delivery shares it; null when they differ.</summary>
    public decimal? Rate { get; init; }
}
