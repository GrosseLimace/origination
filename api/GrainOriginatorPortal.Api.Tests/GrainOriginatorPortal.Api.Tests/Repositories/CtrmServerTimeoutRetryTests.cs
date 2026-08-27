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
    public async Task InteractiveReadsRetryOnceByDefault()
    {
        // The background budget is 4 retries x 8s. Applied to a producer click that was up to 32 seconds of
        // Task.Delay inside the click - worse than the failure it was papering over.
        var calls = 0;
        var result = await CtrmServerTimeoutRetry.RunAsync(
            () => { calls++; return Task.FromResult(Timeout()); },
            Config(), new Mock<ILogger>().Object, "test", interactive: true);

        Assert.False(result.Ok);
        Assert.Equal(2, calls);   // one attempt + one retry
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
