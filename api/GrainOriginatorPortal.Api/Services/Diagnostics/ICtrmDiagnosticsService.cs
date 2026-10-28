namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// CTRM GraphQL probes behind the non-production diagnostics routes (<c>ctrm</c>,
/// <c>ctrm/contracts</c>, <c>ctrm/alias-batch</c>, <c>ctrm/producer-timing</c>). Every method
/// answers 200-shaped data; the environment gate and request validation stay in the controller.
/// </summary>
public interface ICtrmDiagnosticsService
{
    /// <summary>
    /// CTRM GraphQL connectivity probe. Answers auth, egress and build-version in one request, so
    /// the spike can fail fast before any mapping code is exercised.
    /// </summary>
    Task<CtrmConnectivityResult> GetConnectivityAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Runs one producer's contracts through the real repository path and reports what came back,
    /// including which source served it. <paramref name="scoularId"/> is already trimmed and non-empty.
    /// </summary>
    Task<CtrmProducerContractsResult> GetContractsForProducerAsync(string scoularId, CancellationToken cancellationToken);

    /// <summary>Probes whether the API accepts multiple aliased root fields in one document.</summary>
    Task<CtrmAliasBatchResult> GetAliasBatchSupportAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Times one producer's screen the way the client loads it, stage by stage.
    /// <paramref name="scoularId"/> is already trimmed, non-empty and length-checked.
    /// </summary>
    Task<CtrmProducerTimingResult> GetProducerTimingAsync(string scoularId, bool cold, CancellationToken cancellationToken);
}

public sealed record CtrmConnectivityResult
{
    public bool Configured { get; init; }
    public string? Source { get; init; }
    public string? Endpoint { get; init; }
    public CtrmProbeWindow Window { get; init; } = new("", "");
    public string Status { get; init; } = "";
    public int? HttpStatus { get; init; }
    public string? ErrorCode { get; init; }
    public string? Detail { get; init; }
    public int? TotalCountInWindow { get; init; }
    public string? SampleContractId { get; init; }
    public bool Healthy { get; init; }
}

public sealed record CtrmProbeWindow(string From, string To);

public sealed record CtrmProducerContractsResult
{
    public string ScoularId { get; init; } = "";
    public string ServedBy { get; init; } = "";
    public int ContractCount { get; init; }
    public int PricingLineCount { get; init; }
    public IEnumerable<CtrmProducerContractSummary> Contracts { get; init; } = [];
}

/// <summary>Enough per contract to eyeball parity against the screen without dumping everything.</summary>
public sealed record CtrmProducerContractSummary
{
    public long Id { get; init; }
    public bool Synthetic { get; init; }
    public string? SourceContractId { get; init; }
    public string? CtrmCustomerId { get; init; }
    public string? CommodityCode { get; init; }
    public decimal? Quantity { get; init; }
    public decimal? OpenBalanceQuantity { get; init; }
    public decimal? SettledQuantity { get; init; }
    public string? PriceTypeCode { get; init; }
    public string Status { get; init; } = "";
    public DateTime? ContractDate { get; init; }
    public DateTime? DeliveryStart { get; init; }
    public DateTime? DeliveryEnd { get; init; }
    public DateTime? ClosedDate { get; init; }
    public int? CropYear { get; init; }
    public string? CustomerConfirmStatus { get; init; }
    public string? HedgeMarketMonthDescription { get; init; }
    public int PricingLines { get; init; }
}

public sealed record CtrmAliasBatchResult
{
    public string Status { get; init; } = "";
    public int? HttpStatus { get; init; }
    public string? ErrorCode { get; init; }
    public string? Detail { get; init; }
    public List<string> AliasesReturned { get; init; } = [];
    public bool Supported { get; init; }
    public string Meaning { get; init; } = "";
}

public sealed record CtrmProducerTimingResult
{
    public string ScoularId { get; init; } = "";
    public long? CustomerId { get; init; }
    public bool Cold { get; init; }
    public long WallMs { get; init; }
    public List<CtrmTimingStage> Stages { get; init; } = [];
    public CtrmTimingCache Cache { get; init; } = new([], []);
    public string? Failure { get; init; }
    public bool Partial { get; init; }
}

public sealed record CtrmTimingStage(string Name, long? Ms, int Rows, string? Provenance);

public sealed record CtrmTimingCache(IReadOnlyList<string> Contracts, IReadOnlyList<string> Tickets);
