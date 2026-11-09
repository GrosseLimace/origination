using System.Collections.Concurrent;
using Microsoft.Extensions.Configuration;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Ctrm;
using GrainOriginatorPortal.Infrastructure.Platform.Ctrm;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;

/// <summary>
/// A producer's splits from the CTRM GraphQL API. Built ahead of the confirmed query so that switching from
/// <see cref="SampleCtrmSplitReader"/> is a change to <see cref="CtrmSplitQueries.SplitsByCustomer"/> and
/// <see cref="CtrmSplitDto"/> only; see <see cref="CtrmSplitQueries.SplitsQueryConfirmed"/>.
/// </summary>
/// <remarks>
/// Splits change rarely, so each producer's list is cached for <c>Ctrm:TradeUnitCacheMinutes</c>, with one
/// read in flight per producer shared by every caller. Failures are never cached, as in
/// <see cref="CtrmContractReader"/>.
/// </remarks>
public sealed class CtrmSplitReader : ICtrmSplitReader
{
    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly TimeProvider _time;
    private readonly ConcurrentDictionary<string, (DateTimeOffset Expires, Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>> Read)> _cache = new();

    public CtrmSplitReader(ICtrmGraphQlClient client, IConfiguration configuration, TimeProvider? time = null)
    {
        _client = client;
        _configuration = configuration;
        _time = time ?? TimeProvider.System;
    }

    public string Source => "ctrm";

    public async Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>> GetForProducerAsync(string producerCode, CancellationToken cancellationToken)
    {
        var code = producerCode.Trim().ToUpperInvariant();
        if (!_client.IsConfigured) return new() { Status = CtrmReadStatus.NotConfigured, Detail = "CTRM GraphQL is not configured." };

        var now = _time.GetUtcNow();
        var ttl = TimeSpan.FromMinutes(Math.Max(1, CtrmConfig.ReadInt(_configuration, "Ctrm:TradeUnitCacheMinutes", 5)));
        var entry = _cache.AddOrUpdate(
            code,
            _ => (now + ttl, ReadAsync(code)),
            (_, existing) => existing.Expires > now ? existing : (now + ttl, ReadAsync(code)));

        var result = await entry.Read.WaitAsync(cancellationToken);
        if (!result.Ok) _cache.TryRemove(new KeyValuePair<string, (DateTimeOffset, Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>>)>(code, entry));
        return result;
    }

    // Not tied to the first caller's token: the read is shared, so one caller leaving mustn't cancel it for the rest.
    private async Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>> ReadAsync(string code)
    {
        var read = await _client.QueryAsync<CtrmSplitsResponse>(CtrmSplitQueries.SplitsByCustomer, new { customerId = code }, CancellationToken.None);
        if (!read.Ok)
            return new() { Status = read.Status, HttpStatus = read.HttpStatus, Detail = read.Detail, ErrorCode = read.ErrorCode };

        IReadOnlyList<CtrmSplit> splits = (read.Value?.CustomerSplits?.Items ?? [])
            .Where(d => !string.IsNullOrWhiteSpace(d.SplitCustomerId))
            .Select(d => Map(d, code))
            .ToList();
        return new() { Status = read.Status, HttpStatus = read.HttpStatus, Detail = read.Detail, Value = splits };
    }

    public static CtrmSplit Map(CtrmSplitDto d, string producerCode)
    {
        var name = d.Name?.Trim() ?? "";
        // CTRM names a split "PRODUCER - FIELD"; the field is what the producer calls it.
        var dash = name.IndexOf(" - ", StringComparison.Ordinal);
        var fieldName = dash >= 0 ? name[(dash + 3)..].Trim() : name;
        return new CtrmSplit(
            d.SplitCustomerId!.Trim().ToUpperInvariant(),
            (d.PrimaryCustomerId ?? producerCode).Trim().ToUpperInvariant(),
            name,
            fieldName,
            d.SplitPercent ?? 100m,
            d.EffectiveDate is { } effective ? DateOnly.FromDateTime(effective) : DateOnly.MinValue,
            d.Expired ?? false,
            string.Equals(d.SiteType?.Trim(), "BIN", StringComparison.OrdinalIgnoreCase) ? CtrmSplitKind.Bin : CtrmSplitKind.Field);
    }
}
