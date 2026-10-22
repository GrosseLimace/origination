// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;

using Outcome = GrainOriginatorPortal.Infrastructure.Data.OrganicRunCompleteness.Outcome;
using RunMessage = GrainOriginatorPortal.Infrastructure.Data.OrganicRunCompleteness.RunMessage;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The run completeness rules, agreed with the integration team 2026-10-15/16.
///
/// These matter more than their size suggests: this is the gate that would ever let us deactivate a
/// producer on absence. Getting "complete" wrong in the permissive direction would deactivate
/// producers a half-finished run never reached.
/// </summary>
public class OrganicRunCompletenessTests
{
    private static RunMessage Msg(int? position, int? total = 3, string? scoularId = "ABCFARM")
        => new(position, total, scoularId);

    private static OrganicRunCompleteness.Result Assess(params RunMessage[] messages)
        => OrganicRunCompleteness.Assess(messages);

    // ── Complete ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void EveryPositionPresentIsComplete()
    {
        var result = Assess(Msg(1), Msg(2), Msg(3));

        Assert.Equal(Outcome.Complete, result.Outcome);
        Assert.Equal(3, result.RunTotal);
        Assert.Equal(3, result.DistinctPositionsReceived);
        Assert.Equal(0, result.MissingCount);
    }

    [Fact]
    public void PositionsArrivingOutOfOrderAreStillComplete()
    {
        // Nothing guarantees arrival order, and nothing should depend on it.
        Assert.Equal(Outcome.Complete, Assess(Msg(3), Msg(1), Msg(2)).Outcome);
    }

    [Fact]
    public void ARetryOfTheSamePositionIsNotProgress()
    {
        // Counting ROWS rather than distinct positions would call this complete at two of three.
        var result = Assess(Msg(1), Msg(1), Msg(2));

        Assert.Equal(Outcome.Incomplete, result.Outcome);
        Assert.Equal(2, result.DistinctPositionsReceived);
        Assert.Equal([3], result.MissingPositions);
    }

    [Fact]
    public void ASkipFillsItsPositionJustLikeAStoredCertification()
    {
        // The whole point of the skip endpoint. These rules do not know or care which endpoint a
        // message arrived at; a position is filled either way.
        Assert.Equal(Outcome.Complete, Assess(
            Msg(1, scoularId: "AFARM"),
            Msg(2, scoularId: "BFARM"),   // skipped, but it occupied its position
            Msg(3, scoularId: "CFARM")).Outcome);
    }

    // ── Incomplete ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void AMissingPositionIsIncompleteAndNamed()
    {
        var result = Assess(Msg(1), Msg(3));

        Assert.Equal(Outcome.Incomplete, result.Outcome);
        Assert.Equal(1, result.MissingCount);
        Assert.Equal([2], result.MissingPositions);
    }

    [Fact]
    public void ARunThatDiedEarlyNamesOnlyTheFirstFewButCountsThemAll()
    {
        // A run that fails at message 3 of 1,000 is short by 997. Listing them all helps nobody;
        // the count is the useful part past the first handful.
        var messages = Enumerable.Range(1, 2).Select(p => Msg(p, total: 1000)).ToArray();

        var result = OrganicRunCompleteness.Assess(messages);

        Assert.Equal(Outcome.Incomplete, result.Outcome);
        Assert.Equal(998, result.MissingCount);
        Assert.Equal(25, result.MissingPositions.Count);
        Assert.Equal(3, result.MissingPositions[0]);
    }

    // ── Invalid ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void DisagreeingTotalsAreInvalid()
    {
        // The denominator itself is unreliable, so nothing downstream can be trusted.
        var result = Assess(Msg(1, total: 3), Msg(2, total: 4), Msg(3, total: 3));

        Assert.Equal(Outcome.Invalid, result.Outcome);
        Assert.Null(result.RunTotal);
        Assert.Contains(result.Problems, p => p.Contains("disagree on runTotal"));
    }

    [Fact]
    public void APositionAboveTheTotalIsInvalid()
    {
        var result = Assess(Msg(1), Msg(2), Msg(7));

        Assert.Equal(Outcome.Invalid, result.Outcome);
        Assert.Contains(result.Problems, p => p.Contains("outside 1..3"));
    }

    [Fact]
    public void APositionBelowOneIsInvalid()
    {
        // Positions are 1-based. A zero or negative is a numbering bug, not a short run.
        Assert.Equal(Outcome.Invalid, Assess(Msg(0), Msg(1), Msg(2)).Outcome);
    }

    [Fact]
    public void TwoDifferentProducersAtOnePositionIsInvalid()
    {
        var result = Assess(
            Msg(1, scoularId: "AFARM"),
            Msg(1, scoularId: "BFARM"),
            Msg(2), Msg(3));

        Assert.Equal(Outcome.Invalid, result.Outcome);
        Assert.Contains(result.Problems, p => p.Contains("more than one producer"));
    }

    [Fact]
    public void TheSameProducerTwiceAtOnePositionIsNotACollision()
    {
        // A retry. Distinguishing this from a genuine collision is the reason scoularId is carried
        // on the audit row at all.
        var result = Assess(
            Msg(1, scoularId: "AFARM"),
            Msg(1, scoularId: "afarm"),   // same producer, different casing
            Msg(2), Msg(3));

        Assert.Equal(Outcome.Complete, result.Outcome);
    }

    [Fact]
    public void AMessageInARunWithNoPositionIsInvalid()
    {
        // It cannot be counted, so the run cannot be assessed even if everything else is present.
        var result = Assess(Msg(1), Msg(null), Msg(2), Msg(3));

        Assert.Equal(Outcome.Invalid, result.Outcome);
        Assert.Contains(result.Problems, p => p.Contains("no runPosition"));
    }

    [Fact]
    public void SeveralProblemsAreAllReported()
    {
        // One fix at a time is slow when the sender has two bugs. Report everything found.
        var result = Assess(Msg(1, total: 3), Msg(9, total: 4), Msg(null, total: 3));

        Assert.Equal(Outcome.Invalid, result.Outcome);
        Assert.True(result.Problems.Count >= 2, string.Join(" | ", result.Problems));
    }

    // ── Not assessable ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void NoTotalAnywhereIsNotAssessableRatherThanIncomplete()
    {
        // Replays and intraday one-off edits carry no run fields. Calling them "incomplete" would be
        // wrong rather than merely unhelpful — there is no run to be short of.
        //
        // This is also why we do NOT key on the sender's "replay-" prefix: absence of a total is a
        // field that is simply there or not, where a prefix is a string that can be renamed without
        // anything failing loudly.
        var result = Assess(Msg(null, total: null), Msg(null, total: null));

        Assert.Equal(Outcome.NotAssessable, result.Outcome);
        Assert.Null(result.RunTotal);
        Assert.Empty(result.Problems);
    }

    [Fact]
    public void NoMessagesAtAllIsNotAssessable()
        => Assert.Equal(Outcome.NotAssessable, OrganicRunCompleteness.Assess([]).Outcome);

    [Fact]
    public void ARunOfOneProducerCanBeComplete()
    {
        Assert.Equal(Outcome.Complete, Assess(Msg(1, total: 1)).Outcome);
    }

    // ── The case this was built for ──────────────────────────────────────────────────────────

    [Fact]
    public void TheSentinelGapReadsAsIncompleteRatherThanComplete()
    {
        // The open question with the sender: a sentinel dropped by a subscription rule before the
        // skip logic runs would never reach us, leaving a permanent hole. This check is how that
        // surfaces — precisely, and on the first run, instead of by eyeballing row counts.
        var received = Enumerable.Range(1, 838).Select(p => Msg(p, total: 839)).ToArray();

        var result = OrganicRunCompleteness.Assess(received);

        Assert.Equal(Outcome.Incomplete, result.Outcome);
        Assert.Equal(1, result.MissingCount);
        Assert.Equal([839], result.MissingPositions);
    }
}
