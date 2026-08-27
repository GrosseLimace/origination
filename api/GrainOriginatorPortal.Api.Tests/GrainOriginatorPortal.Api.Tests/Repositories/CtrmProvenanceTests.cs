// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// What the API needs in order to answer 503 instead of 200-with-nothing.
/// </summary>
/// <remarks>
/// The repositories return an empty list on failure and never fall back to ODS, so the recorded failure is
/// the ONLY thing that distinguishes an outage from a producer who genuinely has no contracts.
/// </remarks>
public class CtrmProvenanceTests
{
    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(CtrmReadStatus.EgressBlocked)]
    [InlineData(CtrmReadStatus.TokenFailure)]
    [InlineData(CtrmReadStatus.Unauthorized)]
    [InlineData(CtrmReadStatus.Throttled)]
    [InlineData(CtrmReadStatus.QueryError)]
    [InlineData(CtrmReadStatus.Error)]
    [InlineData(CtrmReadStatus.NotConfigured)]
    [InlineData(CtrmReadStatus.Warming)]
    public void EveryMissingAnswerStatusIsAFailure(CtrmReadStatus status)
    {
        var provenance = new CtrmProvenance();

        provenance.RecordFailure("contracts", status, "detail");

        Assert.True(CtrmReadFailure.IsFailure(status));
        Assert.NotNull(provenance.Failure);
        Assert.Equal(status, provenance.Failure!.Status);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void PartialSuccessIsRecordedAsIncompleteRatherThanFailed()
    {
        // Truncated rows are real rows. Promoting this to a 503 would withhold data that is worth showing.
        var provenance = new CtrmProvenance();

        provenance.RecordFailure("tickets", CtrmReadStatus.PartialSuccess, "hit the page cap");

        Assert.Null(provenance.Failure);
        Assert.True(provenance.Partial);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void OkIsNeverAFailure()
    {
        var provenance = new CtrmProvenance();

        provenance.RecordFailure("tickets", CtrmReadStatus.Ok, null);

        Assert.Null(provenance.Failure);
        Assert.False(provenance.Partial);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TheFirstFailureIsKept()
    {
        // A failed contract read usually leaves the ticket read looking empty too; the first is the cause.
        var provenance = new CtrmProvenance();

        provenance.RecordFailure("contracts", CtrmReadStatus.EgressBlocked, "first");
        provenance.RecordFailure("tickets", CtrmReadStatus.Error, "second");

        Assert.Equal("contracts", provenance.Failure!.What);
        Assert.Equal(CtrmReadStatus.EgressBlocked, provenance.Failure.Status);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ASucceedingReadLeavesNoFailure()
    {
        var provenance = new CtrmProvenance();

        provenance.RecordContracts("ctrm", "Ok", 12);
        provenance.RecordTickets("ctrm", "Ok", 40);

        Assert.Null(provenance.Failure);
        Assert.False(provenance.Partial);
    }
}
