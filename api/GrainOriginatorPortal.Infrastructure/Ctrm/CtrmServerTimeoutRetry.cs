using System.Globalization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Retries a CTRM page read that the SERVER timed out, because the server finishes the work anyway.
/// </summary>
/// <remarks>
/// <para>Hot Chocolate answers <c>HC0045</c> ("The request exceeded the configured timeout of 00:00:30")
/// as an HTTP 400 - which the resilience pipeline rightly does not retry, since a 400 is normally a bad
/// request. But this one is not: observed repeatedly against QA and DEV, the server carries on executing
/// the query after it has answered, puts the result in its response cache, and the identical request a
/// few seconds later returns in ~1s. A cold <c>contracts(customerIds:)</c> page for 500 producers is
/// 22-25s on a quiet gateway - right at the limit - so under any concurrent load it tips over.</para>
///
/// <para>So: on <c>HC0045</c> only, wait and re-send the identical page, a bounded number of times. Any
/// other failure returns at once. This is the client-side half of a server-side problem that has been
/// reported to the API owner; when the list filter is fixed this will simply stop being exercised.</para>
/// </remarks>
public static class CtrmServerTimeoutRetry
{
    public const string ServerTimeoutCode = "HC0045";

    public static async Task<CtrmReadResult<T>> RunAsync<T>(
        Func<Task<CtrmReadResult<T>>> attempt,
        IConfiguration configuration,
        ILogger logger,
        string what)
    {
        var retries = Math.Clamp(ReadInt(configuration, "Ctrm:ServerTimeoutRetries", 4), 0, 10);
        var delay = TimeSpan.FromSeconds(Math.Clamp(ReadInt(configuration, "Ctrm:ServerTimeoutRetryDelaySeconds", 8), 0, 60));

        var result = await attempt();
        for (var i = 1; i <= retries && IsServerTimeout(result); i++)
        {
            logger.LogWarning(
                "CTRM server timeout ({Code}) on {What}; the server keeps working and caches the result, so retrying in {Delay}s ({Attempt}/{Max}).",
                ServerTimeoutCode, what, delay.TotalSeconds, i, retries);
            if (delay > TimeSpan.Zero) await Task.Delay(delay);
            result = await attempt();
        }

        return result;
    }

    public static bool IsServerTimeout<T>(CtrmReadResult<T> result) =>
        !result.Ok && string.Equals(result.ErrorCode, ServerTimeoutCode, StringComparison.OrdinalIgnoreCase);

    private static int ReadInt(IConfiguration configuration, string key, int fallback) =>
        int.TryParse(configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : fallback;
}
