using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// One process-wide cap on how many TRADE-UNIT-WIDE CTRM requests are in flight at once.
/// </summary>
/// <remarks>
/// <para>The trade-unit reads (a contract batch of ~25s server-side scans, and a ticket walk of a hundred
/// or more pages) share the gateway with the per-producer reads a user is clicking on right now. Left to
/// their own per-call limits they stacked up to 14 concurrent requests (measured 2026-08-27), and the
/// per-producer calls that normally answer in 1-2s took 13-18s behind them. This throttle bounds the
/// background work so the interactive reads keep their headroom. Per-producer reads deliberately do NOT
/// take a slot here - they must never wait behind a walk.</para>
///
/// <para>Static because the two readers are separate singletons and the cap has to be shared between
/// them. Capacity is read once, on first use, from <c>Ctrm:TradeUnitMaxConcurrentRequests</c>.</para>
/// </remarks>
public static class CtrmTradeUnitThrottle
{
    private static SemaphoreSlim? _slots;
    private static readonly object Init = new();

    public static async Task<T> RunAsync<T>(IConfiguration configuration, Func<Task<T>> work)
    {
        var slots = Slots(configuration);
        await slots.WaitAsync(CancellationToken.None);
        try
        {
            return await work();
        }
        finally
        {
            slots.Release();
        }
    }

    private static SemaphoreSlim Slots(IConfiguration configuration)
    {
        if (_slots is not null) return _slots;
        lock (Init)
        {
            if (_slots is not null) return _slots;
            var capacity = Math.Clamp(
                int.TryParse(configuration["Ctrm:TradeUnitMaxConcurrentRequests"]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : 4,
                1, 16);
            _slots = new SemaphoreSlim(capacity, capacity);
            return _slots;
        }
    }
}
