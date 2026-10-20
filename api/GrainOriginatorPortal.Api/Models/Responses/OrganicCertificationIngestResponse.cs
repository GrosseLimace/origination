namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// What happened to one posted producer.
///
/// Shaped per MESSAGE, not per batch, because the feed sends one producer per POST. An earlier
/// draft carried received/accepted/rejected counts copied from the BarChart response; those read
/// as nonsense for a single producer ("received: 1") and were dropped in favour of naming the
/// outcome directly.
///
/// The one thing deliberately kept from BarChart is the audit correlation — <see cref="BatchId"/>
/// also lands on the OrganicCertificationLoad row and on the stored certification — and the one
/// thing deliberately added is <see cref="Rejections"/>. BarChart reports counts with no per-row
/// detail, so a caller told that some rows failed cannot find out which. A rejected crop must name
/// itself.
/// </summary>
public record OrganicCertificationIngestResponse
{
    /// <summary>Correlates this call with its OrganicCertificationLoad audit row.</summary>
    public Guid BatchId { get; init; }

    /// <summary>The NOP id as received, echoed so the caller can tie the response to what it sent
    /// without holding the request.</summary>
    public string? Nopid { get; init; }

    /// <summary>Whether the operation itself was stored. False only when the operation failed
    /// validation — an unmatched customer does NOT make this false.</summary>
    public bool Accepted { get; init; }

    /// <summary>Whether ScoularId resolved to a producer. False is stored and reported rather than
    /// rejected: a producer we have not onboarded yet is an onboarding gap, not a feed failure, and
    /// the certification is kept so it appears the moment they are added.</summary>
    public bool CustomerMatched { get; init; }

    public int ScopesStored { get; init; }

    public int ItemsStored { get; init; }

    /// <summary>Children dropped for failing validation. The operation still stores; one malformed
    /// crop must not lose the whole certification.</summary>
    public IReadOnlyList<OrganicCertificationRejection> Rejections { get; init; } = [];
}

/// <summary>One rejected element, named well enough for the sender to find and fix it.</summary>
public record OrganicCertificationRejection
{
    /// <summary>"operation", "scope" or "item".</summary>
    public required string Element { get; init; }

    /// <summary>Which one — the scope name or item id. Null when the operation itself failed.</summary>
    public string? Identifier { get; init; }

    /// <summary>Stable machine-readable reason, e.g. MISSING_NOP_OPERATION_ID, DUPLICATE_ITEM_ID.
    /// Callers should branch on this rather than on the message text.</summary>
    public required string Code { get; init; }

    /// <summary>Human-readable explanation. Must never echo payload content beyond the identifier
    /// already named above.</summary>
    public required string Message { get; init; }
}
