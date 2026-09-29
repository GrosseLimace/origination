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
/// other failure returns at once.</para>
///
/// <para><b>The delay has to be long, because the server does not cancel the first copy.</b> A timed-out
/// query runs to completion (70 s and more, measured by the API team), so a re-send a few seconds later
/// competes with it on the same partition and both get slower - that is why both budgets were set to 0 on
/// 2026-09-03. What makes one delayed retry worth having is what the API team documented on 2026-09-28:
/// the slow phase is a fresh Db2 connection's one-time plan compile, ~25-31 s, right at the 30 s limit,
/// after which the query finishes and its result is cached. Re-sent AFTER that window the page comes from
/// cache (measured on the PROD gateway 2026-09-29: the app's batch cold = HC0045 at 31.5 s; the same
/// batch re-sent later = 2.6 s). The background configuration is therefore one retry after 90 s - the
/// shape the API owner himself suggested - and the delay clamp allows it. Both code defaults stay 0 so a
/// missing key fails safe.</para>
///
/// <para><b>Interactive reads keep their own, smaller budget</b> (<c>Ctrm:InteractiveServerTimeoutRetries</c>,
/// 0 in configuration). A producer click that has already waited 30 s should report the failure, which
/// the UI shows with a retry, rather than sit in a <see cref="Task.Delay"/> for another minute and a half.</para>
/// </remarks>
public static class CtrmServerTimeoutRetry
{
    public const string ServerTimeoutCode = "HC0045";

    /// <param name="interactive">True when a user is waiting on this read, which caps the retry budget at
    /// <c>Ctrm:InteractiveServerTimeoutRetries</c> x <c>Ctrm:InteractiveServerTimeoutRetryDelaySeconds</c>
    /// instead of the background budget.</param>
    public static async Task<CtrmReadResult<T>> RunAsync<T>(
        Func<Task<CtrmReadResult<T>>> attempt,
        IConfiguration configuration,
        ILogger logger,
        string what,
        bool interactive = false)
    {
        var retries = interactive
            // Both code defaults are 0: a missing key must fail safe rather than silently restore a budget.
            // The configured background budget is 1 retry after 90 s - see the remarks above for why the
            // delay must be that long.
            ? Math.Clamp(CtrmConfig.ReadInt(configuration, "Ctrm:InteractiveServerTimeoutRetries", 0), 0, 4)
            : Math.Clamp(CtrmConfig.ReadInt(configuration, "Ctrm:ServerTimeoutRetries", 0), 0, 10);
        var delay = interactive
            ? TimeSpan.FromSeconds(Math.Clamp(CtrmConfig.ReadInt(configuration, "Ctrm:InteractiveServerTimeoutRetryDelaySeconds", 3), 0, 30))
            // Clamp raised 60 -> 120 (2026-09-29) so the 90 s the API owner asked for is representable.
            : TimeSpan.FromSeconds(Math.Clamp(CtrmConfig.ReadInt(configuration, "Ctrm:ServerTimeoutRetryDelaySeconds", 8), 0, 120));

        var result = await attempt();
        for (var i = 1; i <= retries && IsServerTimeout(result); i++)
        {
            logger.LogWarning(
                "CTRM server timeout ({Code}) on {What} ({Kind}); the server keeps working and caches the result, so retrying in {Delay}s ({Attempt}/{Max}).",
                ServerTimeoutCode, what, interactive ? "interactive" : "background", delay.TotalSeconds, i, retries);
            if (delay > TimeSpan.Zero) await Task.Delay(delay);
            result = await attempt();
        }

        return result;
    }

    public static bool IsServerTimeout<T>(CtrmReadResult<T> result) =>
        !result.Ok && string.Equals(result.ErrorCode, ServerTimeoutCode, StringComparison.OrdinalIgnoreCase);
}
