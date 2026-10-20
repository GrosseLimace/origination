namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Decides whether one nightly certification run FINISHED.
///
/// ── Why this exists ──
/// The feed sends one message per producer with no batch boundary, so until now a producer that
/// stopped arriving and a producer that was never sent looked identical. That ambiguity is the only
/// reason we cannot act on a producer's absence: deactivating on "we did not hear about them" would
/// also deactivate everyone a half-finished run never reached.
///
/// ── The scheme, agreed with the sender 2026-10-15/16 ──
/// Every message in a run carries the run id, this producer's position, and the run total. The total
/// counts producers CONSIDERED, not sent, because the sender only discovers mid-run that a producer
/// has no USDA record. Producers it chooses not to send arrive as skip notices filling their own
/// position. So a complete run is simply one where we hold every position.
///
/// ── Three outcomes, not two ──
/// <list type="bullet">
/// <item><b>Complete</b> — we hold every position. Safe to reason about absence.</item>
/// <item><b>Incomplete</b> — internally consistent but short. The run died, or is still going. Wait.</item>
/// <item><b>Invalid</b> — internally contradictory. Do not trust this run's numbers at all.</item>
/// </list>
/// The difference between the last two matters: incomplete is normal and self-resolving, invalid
/// means something is wrong and is worth telling someone about.
///
/// Deliberately <c>public static</c> and free of any database type, so the rules can be unit-tested
/// exhaustively without a context. Follows <see cref="OrganicCertificationStatus"/>.
/// </summary>
public static class OrganicRunCompleteness
{
    /// <summary>One audit row, reduced to just what the rules need.</summary>
    /// <param name="Position">Null when the message carried no position.</param>
    /// <param name="Total">Null when the message carried no total.</param>
    /// <param name="ScoularId">Used only to detect two different producers at one position.</param>
    public readonly record struct RunMessage(int? Position, int? Total, string? ScoularId);

    public enum Outcome
    {
        /// <summary>No message in this run carried a total, so there is nothing to assess against.
        /// Replays and intraday edits land here by design — they carry no run fields.</summary>
        NotAssessable,
        Complete,
        Incomplete,
        Invalid,
    }

    public sealed record Result
    {
        public required Outcome Outcome { get; init; }

        /// <summary>The agreed total, when every message that carried one agreed. Null otherwise.</summary>
        public int? RunTotal { get; init; }

        public int DistinctPositionsReceived { get; init; }

        /// <summary>Positions we never saw. Capped — a run that died early is missing hundreds, and a
        /// list that long helps nobody. <see cref="MissingCount"/> is always exact.</summary>
        public IReadOnlyList<int> MissingPositions { get; init; } = [];

        public int MissingCount { get; init; }

        /// <summary>Why the run is Invalid. Empty for every other outcome.</summary>
        public IReadOnlyList<string> Problems { get; init; } = [];
    }

    /// <summary>How many missing positions to name before summarising. A failed run can be short by
    /// hundreds; the count is what matters past the first handful.</summary>
    private const int MaxMissingListed = 25;

    /// <summary>
    /// Assesses one run. Pass every audit row recorded under that run id, ingest and skip alike —
    /// completeness is counted across both, because a skipped producer fills its position just as a
    /// stored certification does.
    /// </summary>
    public static Result Assess(IEnumerable<RunMessage> messages)
    {
        ArgumentNullException.ThrowIfNull(messages);

        var rows = messages.ToList();
        var problems = new List<string>();

        // A run is measured against its total. No total anywhere means this is not a nightly run at
        // all — a replay or an intraday edit — and saying "incomplete" about it would be wrong
        // rather than merely unhelpful.
        var totals = rows.Where(r => r.Total is not null)
                         .Select(r => r.Total!.Value)
                         .Distinct()
                         .ToList();

        if (totals.Count == 0)
        {
            return new Result { Outcome = Outcome.NotAssessable };
        }

        // Disagreeing totals: the denominator itself is unreliable, so nothing downstream can be
        // trusted. Reported before anything else because every other check depends on the total.
        if (totals.Count > 1)
        {
            problems.Add(
                $"Messages disagree on runTotal ({string.Join(", ", totals.OrderBy(t => t))}).");
        }

        var total = totals.Count == 1 ? totals[0] : (int?)null;

        // A message in a run with no position cannot be counted, so the run cannot be assessed even
        // if every other position is present.
        var withoutPosition = rows.Count(r => r.Position is null);
        if (withoutPosition > 0)
        {
            problems.Add($"{withoutPosition} message(s) carried no runPosition.");
        }

        var positions = rows.Where(r => r.Position is not null)
                            .Select(r => r.Position!.Value)
                            .ToList();

        // A position above the total means the sender's numbering and its total disagree.
        if (total is { } t)
        {
            var overrun = positions.Where(p => p > t || p < 1).Distinct().OrderBy(p => p).ToList();
            if (overrun.Count > 0)
            {
                problems.Add(
                    $"Position(s) outside 1..{t}: {string.Join(", ", overrun.Take(10))}" +
                    (overrun.Count > 10 ? $" and {overrun.Count - 10} more." : "."));
            }
        }

        // Two DIFFERENT producers at one position means the numbering is wrong. The same producer
        // twice is just a retry and is expected — the sender may re-send, and counting rows rather
        // than distinct positions would read a retry as progress.
        var collisions = rows
            .Where(r => r.Position is not null)
            .GroupBy(r => r.Position!.Value)
            .Where(g => g.Select(r => (r.ScoularId ?? string.Empty).Trim())
                         .Where(s => s.Length > 0)
                         .Distinct(StringComparer.OrdinalIgnoreCase)
                         .Count() > 1)
            .Select(g => g.Key)
            .OrderBy(p => p)
            .ToList();

        if (collisions.Count > 0)
        {
            problems.Add(
                $"Position(s) used by more than one producer: {string.Join(", ", collisions.Take(10))}" +
                (collisions.Count > 10 ? $" and {collisions.Count - 10} more." : "."));
        }

        var distinct = positions.Distinct().ToHashSet();

        if (problems.Count > 0)
        {
            return new Result
            {
                Outcome = Outcome.Invalid,
                RunTotal = total,
                DistinctPositionsReceived = distinct.Count,
                Problems = problems,
            };
        }

        var missing = Enumerable.Range(1, total!.Value).Where(p => !distinct.Contains(p)).ToList();

        return new Result
        {
            Outcome = missing.Count == 0 ? Outcome.Complete : Outcome.Incomplete,
            RunTotal = total,
            DistinctPositionsReceived = distinct.Count,
            MissingCount = missing.Count,
            MissingPositions = missing.Take(MaxMissingListed).ToList(),
        };
    }
}
