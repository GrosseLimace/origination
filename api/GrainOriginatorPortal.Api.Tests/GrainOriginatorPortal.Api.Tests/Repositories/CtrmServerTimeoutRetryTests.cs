// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The server-timeout retry exists because Hot Chocolate answers HC0045 and then finishes the work anyway;
/// these pin that it retries THAT and nothing else, and that it is bounded.
/// </summary>
public class CtrmServerTimeoutRetryTests
{
    private static IConfiguration Config(int retries = 4, int? interactiveRetries = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:ServerTimeoutRetries"] = retries.ToString(),
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractiveServerTimeoutRetries"] = interactiveRetries?.ToString(),
            ["Ctrm:InteractiveServerTimeoutRetryDelaySeconds"] = "0"
        }).Build();

    private static CtrmReadResult<int> Timeout() => new() { Status = CtrmReadStatus.QueryError, HttpStatus = 400, ErrorCode = "HC0045", Detail = "timeout" };
    private static CtrmReadResult<int> Ok() => new() { Status = CtrmReadStatus.Ok, Value = 1 };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AServerTimeoutIsRetriedAndTheLaterSuccessIsReturned()
    {
        var calls = 0;
        var result = await CtrmServerTimeoutRetry.RunAsync(
            () => Task.FromResult(++calls < 3 ? Timeout() : Ok()),
            Config(), new Mock<ILogger>().Object, "test");

        Assert.True(result.Ok);
        Assert.Equal(3, calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task OtherFailuresAreNotRetried()
    {
        // A 401 or a real validation error will not get better by asking again.
        var calls = 0;
        var result = await CtrmServerTimeoutRetry.RunAsync(
            () => { calls++; return Task.FromResult(new CtrmReadResult<int> { Status = CtrmReadStatus.Unauthorized, HttpStatus = 401 }); },
            Config(), new Mock<ILogger>().Object, "test");

        Assert.False(result.Ok);
        Assert.Equal(1, calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheRetryIsBounded()
    {
        var calls = 0;
        var result = await CtrmServerTimeoutRetry.RunAsync(
            () => { calls++; return Task.FromResult(Timeout()); },
            Config(retries: 2), new Mock<ILogger>().Object, "test");

        Assert.False(result.Ok);
        Assert.Equal("HC0045", result.ErrorCode);
        Assert.Equal(3, calls);   // one attempt + two retries
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ASuccessIsNotRetried()
    {
        var calls = 0;
        await CtrmServerTimeoutRetry.RunAsync(() => { calls++; return Task.FromResult(Ok()); }, Config(), new Mock<ILogger>().Object, "test");
        Assert.Equal(1, calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AnAbsentInteractiveBudgetMeansNoRetryAtAll_NotTheOldOneRetryDefault()
    {
        // Both budgets default to 0, so a missing key cannot silently reintroduce retrying. CTRM cannot
        // cancel a query that overruns - it runs to completion whatever either side configures (measured:
        // a 10s client timeout let an 86s query finish and return full results) - so a re-send only adds a
        // second copy competing with the first on the same partition. This used to default to one retry.
        var calls = 0;
        var result = await CtrmServerTimeoutRetry.RunAsync(
            () => { calls++; return Task.FromResult(Timeout()); },
            Config(), new Mock<ILogger>().Object, "test", interactive: true);

        Assert.False(result.Ok);
        Assert.Equal(1, calls);   // the one attempt, and nothing behind it
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AnAbsentBackgroundBudgetAlsoMeansNoRetry()
    {
        // Same fail-safe on the background path, which is where the old 4 x 8s budget could put five copies
        // of one 70s query in flight inside about half a minute.
        var calls = 0;
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
        }).Build();

        var result = await CtrmServerTimeoutRetry.RunAsync(
            () => { calls++; return Task.FromResult(Timeout()); },
            config, new Mock<ILogger>().Object, "test");

        Assert.False(result.Ok);
        Assert.Equal(1, calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task InteractiveRetriesAreConfiguredSeparately()
    {
        var calls = 0;
        await CtrmServerTimeoutRetry.RunAsync(
            () => { calls++; return Task.FromResult(Timeout()); },
            Config(retries: 4, interactiveRetries: 3), new Mock<ILogger>().Object, "test", interactive: true);

        Assert.Equal(4, calls);   // interactive budget applies, not the background 4x
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BackgroundReadsKeepTheLargerBudget()
    {
        var calls = 0;
        await CtrmServerTimeoutRetry.RunAsync(
            () => { calls++; return Task.FromResult(Timeout()); },
            Config(retries: 4, interactiveRetries: 1), new Mock<ILogger>().Object, "test");

        Assert.Equal(5, calls);   // one attempt + four retries
    }
}
