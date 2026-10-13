// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The keep-warm cycle's per-producer-set failure isolation. One set failing, whether by a non-Ok
/// read or by throwing, must neither end the cycle nor touch any other set, and a failed set must be
/// left alone for the back-off window rather than re-walked every five minutes while the gateway is
/// struggling. These were unreachable until the reads went behind <see cref="ICtrmWarmReads"/>;
/// <c>CtrmKeepWarmServiceTests</c> covers the cadence gate in front of this cycle.
/// </summary>
public class CtrmKeepWarmCycleTests
{
    private static readonly DateTime Now = new(2026, 10, 13, 15, 0, 0, DateTimeKind.Utc);

    private static readonly string[] SetA = ["AAA01", "AAA02"];
    private static readonly string[] SetB = ["BBB01"];
    private static readonly string[] SetC = ["CCC01", "CCC02", "CCC03"];

    /// <summary>A fake that answers per set: Ok by default, a failed status or an exception where told.</summary>
    private sealed class FakeReads : ICtrmWarmReads
    {
        public readonly List<string> ContractCalls = [];
        public readonly List<string> TicketCalls = [];
        public readonly List<string> SpotLoadCalls = [];
        public readonly HashSet<string> ContractsFailFor = new(StringComparer.Ordinal);
        public readonly HashSet<string> TicketsFailFor = new(StringComparer.Ordinal);
        public readonly HashSet<string> ThrowFor = new(StringComparer.Ordinal);

        private static string Key(IReadOnlyCollection<string> codes) => string.Join(",", codes);

        public Task<CtrmReadResult<List<CtrmContractDto>>> ContractsAsync(IReadOnlyCollection<string> codes, CancellationToken cancellationToken)
        {
            var key = Key(codes);
            ContractCalls.Add(key);
            if (ThrowFor.Contains(key)) throw new InvalidOperationException("gateway exploded for " + key);
            return Task.FromResult(new CtrmReadResult<List<CtrmContractDto>>
            {
                Status = ContractsFailFor.Contains(key) ? CtrmReadStatus.NotConfigured : CtrmReadStatus.Ok,
                Value = [],
            });
        }

        public Task<CtrmReadResult<List<CtrmTicketDto>>> TicketHistoryAsync(IReadOnlyCollection<string> codes, CancellationToken cancellationToken)
        {
            var key = Key(codes);
            TicketCalls.Add(key);
            return Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>>
            {
                Status = TicketsFailFor.Contains(key) ? CtrmReadStatus.NotConfigured : CtrmReadStatus.Ok,
                Value = [],
            });
        }

        public Task<CtrmReadResult<List<CtrmTicketDto>>> SpotLoadsAsync(IReadOnlyCollection<string> codes, DateTime from, DateTime to, CancellationToken cancellationToken)
        {
            SpotLoadCalls.Add(Key(codes));
            return Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = [] });
        }
    }

    private static (CtrmKeepWarmService Sut, FakeReads Reads, CtrmWarmRegistry Registry) Build(params string[][] activeSets)
    {
        var registry = new CtrmWarmRegistry();
        foreach (var set in activeSets) registry.Touch(set, DateTime.UtcNow);
        var reads = new FakeReads();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = "ctrm",
            ["Ctrm:KeepWarmForHours"] = "2",
            ["Ctrm:KeepWarmFailureBackoffMinutes"] = "15",
            ["Ctrm:RecentTicketDays"] = "30",
        }).Build();
        var sut = new CtrmKeepWarmService(registry, reads, config, new Mock<ILogger<CtrmKeepWarmService>>().Object);
        return (sut, reads, registry);
    }

    /// <summary>The registry orders sets most-recently-touched first, so the LAST set passed to Build
    /// is warmed first. Tests touch sets in the order that puts the failing one in the middle.</summary>
    private static string K(string[] set) => string.Join(",", set);

    [Fact]
    public async Task EverySetIsWarmedWhenEveryReadSucceeds()
    {
        var (sut, reads, _) = Build(SetA, SetB, SetC);

        await sut.WarmActiveSetsAsync(CancellationToken.None);

        Assert.Equal(3, reads.ContractCalls.Count);
        Assert.Equal(3, reads.TicketCalls.Count);
        Assert.Equal(3, reads.SpotLoadCalls.Count);
    }

    [Fact]
    public async Task ASetWhoseReadThrowsDoesNotStopTheSetsAfterIt()
    {
        var (sut, reads, _) = Build(SetC, SetB, SetA); // warm order: A, B, C
        reads.ThrowFor.Add(K(SetB));

        await sut.WarmActiveSetsAsync(CancellationToken.None);

        Assert.Contains(K(SetA), reads.ContractCalls);
        Assert.Contains(K(SetB), reads.ContractCalls);     // it was attempted…
        Assert.Contains(K(SetC), reads.ContractCalls);     // …and the cycle carried on past it
        Assert.DoesNotContain(K(SetB), reads.TicketCalls); // nothing further for the set that threw
        Assert.Contains(K(SetC), reads.SpotLoadCalls);
    }

    [Fact]
    public async Task AFailedContractReadSkipsThatSetsTicketAndSpotLoadReadsOnly()
    {
        var (sut, reads, _) = Build(SetC, SetB, SetA);
        reads.ContractsFailFor.Add(K(SetB));

        await sut.WarmActiveSetsAsync(CancellationToken.None);

        Assert.DoesNotContain(K(SetB), reads.TicketCalls);
        Assert.DoesNotContain(K(SetB), reads.SpotLoadCalls);
        Assert.Contains(K(SetA), reads.SpotLoadCalls);
        Assert.Contains(K(SetC), reads.SpotLoadCalls);
    }

    [Fact]
    public async Task AFailedTicketReadStillSkipsSpotLoadsForThatSet()
    {
        var (sut, reads, _) = Build(SetB);
        reads.TicketsFailFor.Add(K(SetB));

        await sut.WarmActiveSetsAsync(CancellationToken.None);

        Assert.Single(reads.ContractCalls);
        Assert.Single(reads.TicketCalls);
        Assert.Empty(reads.SpotLoadCalls);
    }

    [Fact]
    public async Task AFailedSetIsLeftAloneOnTheNextCycleWhileTheOthersAreWarmedAgain()
    {
        // While the gateway is slow, re-walking a set that just timed out only queues more work
        // behind the queries the server is still running; the back-off is what prevents that.
        var (sut, reads, _) = Build(SetC, SetB, SetA);
        reads.ContractsFailFor.Add(K(SetB));

        await sut.WarmActiveSetsAsync(CancellationToken.None);
        reads.ContractCalls.Clear();
        await sut.WarmActiveSetsAsync(CancellationToken.None);

        Assert.Contains(K(SetA), reads.ContractCalls);
        Assert.Contains(K(SetC), reads.ContractCalls);
        Assert.DoesNotContain(K(SetB), reads.ContractCalls); // backed off, not retried
    }

    [Fact]
    public async Task AFailedSetStaysBackedOffEvenIfTheGatewayRecoversInsideTheWindow()
    {
        var (sut, reads, _) = Build(SetB);
        reads.ContractsFailFor.Add(K(SetB));
        await sut.WarmActiveSetsAsync(CancellationToken.None);   // fails, backed off for 15 min

        // The gateway recovers straight away, but the set is still inside its 15-minute window.
        reads.ContractsFailFor.Clear();
        reads.ContractCalls.Clear();
        await sut.WarmActiveSetsAsync(CancellationToken.None);

        // Still inside the back-off window, so still left alone. This pins that a recovered gateway
        // does not short-circuit the window: the cost of the window is bounded and deliberate.
        Assert.Empty(reads.ContractCalls);
    }

    [Fact]
    public async Task NothingIsReadWhenNoSetIsActive()
    {
        var (sut, reads, _) = Build();

        await sut.WarmActiveSetsAsync(CancellationToken.None);

        Assert.Empty(reads.ContractCalls);
    }
}
