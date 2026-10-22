namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Whether one nightly certification run finished.
///
/// Written to be read by a person at 9am asking "did last night's feed work", so it names the
/// outcome in words and explains itself rather than handing back raw counts to interpret.
/// </summary>
public record OrganicRunCompletenessResponse
{
    public string FeedRunId { get; init; } = string.Empty;

    /// <summary>Complete, Incomplete, Invalid or NotAssessable. See <see cref="Summary"/> for what
    /// each means in practice.</summary>
    public string Outcome { get; init; } = string.Empty;

    /// <summary>One sentence a human can act on without reading the rest.</summary>
    public string Summary { get; init; } = string.Empty;

    /// <summary>Producers the sender CONSIDERED, not the ones it sent. Null when no message carried
    /// a total, or when messages disagreed on it.</summary>
    public int? RunTotal { get; init; }

    public int DistinctPositionsReceived { get; init; }

    public int MissingCount { get; init; }

    /// <summary>The first few missing positions. Capped: a run that died early is short by hundreds
    /// and listing them all helps nobody. <see cref="MissingCount"/> is always exact.</summary>
    public IReadOnlyList<int> MissingPositions { get; init; } = [];

    /// <summary>Why the run is Invalid. Empty otherwise.</summary>
    public IReadOnlyList<string> Problems { get; init; } = [];

    // ── Context, for the person reading this rather than for the rules ──────────────────────────
    public int MessagesReceived { get; init; }
    public int Stored { get; init; }
    public int Skipped { get; init; }
    public int Rejected { get; init; }

    public DateTime? FirstMessageOn { get; init; }
    public DateTime? LastMessageOn { get; init; }
}
