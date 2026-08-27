using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>What a ticket-pool load produced. Raw DTOs, not entities, for the same mutation-hazard
/// reason as <see cref="CtrmSnapshotResult"/>.</summary>
public sealed record CtrmTicketPoolResult
{
    public CtrmReadStatus Status { get; init; }
    public bool Ok => Status is CtrmReadStatus.Ok or CtrmReadStatus.PartialSuccess;
    public string? Detail { get; init; }

    /// <summary>Every ticket header CTRM holds for the in-scope producers across the lookback.</summary>
    public List<CtrmTicketDto> Tickets { get; init; } = [];

    public int Producers { get; init; }
    public int Windows { get; init; }

    /// <summary>True when a per-window page cap stopped a chunk while CTRM still had rows.</summary>
    public bool Truncated { get; init; }

    public DateTime LoadedAtUtc { get; init; }
    public string? Scope { get; init; }
}

/// <summary>
/// Caches every ticket CTRM holds for the in-scope producers over the lookback, and serves the
/// trade-unit-wide ticket read from it.
/// </summary>
/// <remarks>
/// <para><b>Why a snapshot.</b> The trade-unit-wide ticket read backs every Build-a-List prompt that
/// mentions tickets, deliveries, unapplied or unsettled. It was the last contract/ticket read still on
/// ODS, because there was no server-side way to ask for it cheaply. There still is not an INTERACTIVE
/// way: for the real producer population it is roughly 240 pages of 500 rows at 3-5s each - a few
/// minutes at four-way concurrency. That is fine once in the background and unacceptable on a click,
/// so the walk happens here, once, and the read filters the result in memory. Same shape, same reasons,
/// as <see cref="CtrmContractSnapshot"/>.</para>
///
/// <para><b>Why all tickets and not just unapplied.</b> The API now has <c>unappliedOnly</c>, which
/// would cut the walk to a fifth. But the ODS read this replaces returns applied tickets too, and the
/// prompts that route to it - "delivered", "deliveries", "unsettled" - depend on that half. Serving only
/// the unapplied set would make those prompts silently wrong, which is the failure this whole effort
/// exists to prevent. So the pool carries both and the repository applies the same two-branch rule the
/// producer screen uses.</para>
///
/// <para><b>Why a producer scope and not a date window.</b> <c>customerIds</c> on <c>tickets</c> is fast
/// for real producers - the 25-second pages measured earlier were elevator counterparties with ~25k
/// tickets a year each, not the list filter. Scoping by producer is what the ODS read does, so the pool
/// covers exactly the population the prompts ask about.</para>
///
/// <para>Paging lives in <see cref="CtrmTicketReader"/>; this class keeps the long-lived cache and the
/// serve-stale-during-rebuild behaviour, which is what callers actually depend on.</para>
/// </remarks>
public sealed class CtrmTicketPoolSnapshot
{
    /// <summary>How long a failed load is remembered before another attempt, so an outage costs one
    /// request the full timeout rather than every request.</summary>
    private static readonly TimeSpan FailureBackoff = TimeSpan.FromSeconds(60);

    private readonly ICtrmGraphQlClient _client;
    private readonly CtrmTicketReader _reader;
    private readonly IConfiguration _configuration;
    private readonly IServiceScopeFactory? _scopeFactory;
    private readonly ILogger<CtrmTicketPoolSnapshot> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private CtrmTicketPoolResult? _cached;
    private DateTime _cachedAtUtc = DateTime.MinValue;

    /// <param name="scopeFactory">Resolves the producer set from <see cref="ApplicationDbContext"/>,
    /// which is scoped while this class is a singleton. Optional so tests can build the snapshot without
    /// a container; a null factory means no producers and therefore a hard failure to load.</param>
    public CtrmTicketPoolSnapshot(
        ICtrmGraphQlClient client,
        CtrmTicketReader reader,
        IConfiguration configuration,
        ILogger<CtrmTicketPoolSnapshot> logger,
        IServiceScopeFactory? scopeFactory = null)
    {
        _client = client;
        _reader = reader;
        _configuration = configuration;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    /// <summary>
    /// Returns the current pool, loading or refreshing it if needed. Concurrent callers share one load.
    /// </summary>
    /// <remarks>
    /// Never blocks on a build in progress. A caller that cannot take the gate is served the previous
    /// copy if there is one, and told <see cref="CtrmReadStatus.Warming"/> if there is not - a walk of
    /// this size must never hold a request open for its duration.
    /// </remarks>
    public async Task<CtrmTicketPoolResult> GetAsync(CancellationToken cancellationToken)
    {
        if (TryGetFresh(out var fresh))
            return fresh;

        if (!await _gate.WaitAsync(0, cancellationToken))
        {
            if (_cached is not null)
                return _cached with { Detail = $"Serving the previous ticket pool while a rebuild is in progress. {_cached.Detail}".TrimEnd() };

            return new CtrmTicketPoolResult
            {
                Status = CtrmReadStatus.Warming,
                Detail = "The CTRM ticket pool is still being built. Nothing is cached yet - retry shortly."
            };
        }

        try
        {
            if (TryGetFresh(out var loaded))
                return loaded;

            var result = await LoadAsync(cancellationToken);
            _cached = result;
            _cachedAtUtc = DateTime.UtcNow;
            return result;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Drops the cache so the next read refetches.</summary>
    public void Invalidate()
    {
        _cached = null;
        _cachedAtUtc = DateTime.MinValue;
    }

    /// <summary>Marks the pool stale while keeping it, so readers see the old copy until the rebuild lands.</summary>
    public void MarkStale() => _cachedAtUtc = DateTime.MinValue;

    private bool TryGetFresh(out CtrmTicketPoolResult result)
    {
        result = default!;
        if (_cached is null) return false;

        var ttl = _cached.Ok
            ? TimeSpan.FromMinutes(Math.Max(1, ReadInt("Ctrm:TicketPoolMinutes", ReadInt("Ctrm:SnapshotMinutes", 720))))
            : FailureBackoff;

        if (DateTime.UtcNow - _cachedAtUtc >= ttl) return false;

        result = _cached;
        return true;
    }

    private async Task<CtrmTicketPoolResult> LoadAsync(CancellationToken cancellationToken)
    {
        if (!_client.IsConfigured)
            return new CtrmTicketPoolResult
            {
                Status = CtrmReadStatus.NotConfigured,
                Detail = "The CTRM client is not configured - no endpoint, audience or credential."
            };

        var producerCodes = await LoadActiveProducerCodesAsync(cancellationToken);
        if (producerCodes.Count == 0)
            return new CtrmTicketPoolResult
            {
                Status = CtrmReadStatus.Error,
                Detail = "No active producers with a ScoularId were found in the customer table, so the ticket "
                       + "pool would have nothing to scope on. Refusing to build an empty pool."
            };

        var lookbackDays = Math.Max(1, ReadInt("Ctrm:TicketLookbackDays", 1095));
        var windows = CtrmTicketReader.BuildWindows(DateTime.Today, lookbackDays);
        var scope = $"{producerCodes.Count} producers x {windows.Count} window(s), {lookbackDays}-day lookback";

        // Windows run one after another, not together: each window is itself fanned out across producer
        // chunks and pages at the configured concurrency, and stacking three of those would compete for
        // the same gateway capacity that the per-producer reads on the producer screen need right now.
        var all = new List<CtrmTicketDto>();
        var truncated = false;

        foreach (var (from, to) in windows)
        {
            var read = await _reader.ReadForProducersAsync(producerCodes, from, to);
            if (!read.Ok)
                return new CtrmTicketPoolResult
                {
                    Status = read.Status,
                    Detail = $"Ticket pool load failed on window {from:yyyy-MM-dd}..{to:yyyy-MM-dd}: {read.Detail}",
                    Scope = scope
                };

            if (read.Status == CtrmReadStatus.PartialSuccess) truncated = true;
            all.AddRange(read.Value ?? []);
        }

        _logger.LogInformation(
            "CTRM ticket pool built: {Count} ticket headers for {Producers} producers across {Windows} window(s){Truncated}.",
            all.Count, producerCodes.Count, windows.Count, truncated ? " - TRUNCATED" : string.Empty);

        return new CtrmTicketPoolResult
        {
            Status = truncated ? CtrmReadStatus.PartialSuccess : CtrmReadStatus.Ok,
            Detail = truncated ? "At least one window hit its page cap; the pool is a partial view." : null,
            Tickets = all,
            Producers = producerCodes.Count,
            Windows = windows.Count,
            Truncated = truncated,
            LoadedAtUtc = DateTime.UtcNow,
            Scope = scope
        };
    }

    private async Task<List<string>> LoadActiveProducerCodesAsync(CancellationToken cancellationToken)
    {
        if (_scopeFactory is null)
        {
            _logger.LogWarning("CTRM ticket pool has no service scope factory - cannot resolve producer codes.");
            return [];
        }

        using var scope = _scopeFactory.CreateScope();
        var appContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var codes = await appContext.Customers
            .AsNoTracking()
            .Where(c => c.IsActive && c.ScoularId != null)
            .Select(c => c.ScoularId!)
            .ToListAsync(cancellationToken);

        return [.. codes.Select(c => c.Trim()).Distinct(StringComparer.OrdinalIgnoreCase)];
    }

    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
}
