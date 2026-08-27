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
    private static IConfiguration Config(int retries = 4) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:ServerTimeoutRetries"] = retries.ToString(),
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
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
}
