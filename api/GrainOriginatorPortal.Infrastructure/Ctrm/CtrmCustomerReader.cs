using System.Diagnostics;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads CTRM customer master records by producer code (<c>sourceCode</c>) for the nightly customer sync.
/// </summary>
/// <remarks>
/// <para><b>Aliased, because the list filter is not verified.</b> <c>customers(sourceCode:)</c> is
/// confirmed; a <c>sourceCodes:</c> list argument is not. So each request carries
/// <c>CustomerSync:CustomerAliasCount</c> aliased <c>customers(sourceCode:)</c> fields - the same shape
/// the contract reader's aliased strategy proved safe - and <c>CustomerSync:CtrmConcurrency</c> requests
/// are in flight at once, all behind <see cref="CtrmTradeUnitThrottle"/> so a nightly run stands aside for
/// user clicks.</para>
///
/// <para>Logs carry counts and timings only - never customer names, phones or addresses.</para>
/// </remarks>
public sealed class CtrmCustomerReader
{
    public const string AliasCountKey = "CustomerSync:CustomerAliasCount";
    public const string ConcurrencyKey = "CustomerSync:CtrmConcurrency";
    public const string SourceSystemKey = "CustomerSync:CtrmSourceSystem";

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmCustomerReader> _logger;

    public CtrmCustomerReader(ICtrmGraphQlClient client, IConfiguration configuration, ILogger<CtrmCustomerReader> logger)
    {
        _client = client;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Looks up every code; the result is keyed by the requested (trimmed) code, case-insensitively.
    /// </summary>
    public async Task<CtrmReadResult<CtrmCustomerLookup>> GetBySourceCodesAsync(
        IReadOnlyCollection<string> sourceCodes, CancellationToken cancellationToken)
    {
        // The 7-character limit is a customerIds defect, not a sourceCode one - keep every code.
        var codes = CtrmCustomerCodes.NormalizeKeepingAll(sourceCodes);
        var lookup = new CtrmCustomerLookup { Requested = codes.Count };
        if (codes.Count == 0)
            return new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.Ok, Value = lookup };

        var aliasCount = Math.Clamp(CtrmConfig.ReadInt(_configuration, AliasCountKey, 20), 1, 50);
        var concurrency = Math.Clamp(CtrmConfig.ReadInt(_configuration, ConcurrencyKey, 2), 1, 8);
        var sourceSystem = _configuration[SourceSystemKey]?.Trim();
        if (string.IsNullOrEmpty(sourceSystem)) sourceSystem = null;

        var chunks = codes.Chunk(aliasCount).Select(c => (IReadOnlyList<string>)c.ToList()).ToList();
        using var slot = new SemaphoreSlim(concurrency, concurrency);
        var stopwatch = Stopwatch.StartNew();
        var requests = 0;

        async Task<List<(string Code, List<CtrmCustomerDto> Items)>> One(int index, IReadOnlyList<string> chunk)
        {
            await slot.WaitAsync(cancellationToken);
            try
            {
                Interlocked.Increment(ref requests);
                var document = CtrmCustomerQueries.CustomersBySourceCodesAliased(chunk, sourceSystem);
                var read = await CtrmTradeUnitThrottle.RunAsync(_configuration, () => CtrmServerTimeoutRetry.RunAsync(
                    () => _client.QueryAsync<Dictionary<string, CtrmPage<CtrmCustomerDto>>>(document, null, cancellationToken),
                    _configuration, _logger, $"customers chunk {index}"));

                var pages = read.Value!;
                return [.. chunk.Select((code, i) => (code, pages[$"c{i}"].Items))];
            }
            finally
            {
                slot.Release();
            }
        }

        var results = await Task.WhenAll(chunks.Select((chunk, index) => One(index, chunk)));

        foreach (var (code, items) in results.SelectMany(r => r))
        {
            if (items.Count == 0)
            {
                lookup.Missing++;
                continue;
            }
            lookup.ByCode[code] = items[0];
        }
        lookup.Found = lookup.ByCode.Count;
        lookup.Requests = requests;

        _logger.LogInformation(
            "CTRM customer lookup: {Requested} code(s), {Found} found, {Missing} missing, {Duplicates} with duplicate rows, via {Requests} request(s) of up to {AliasCount} alias(es) in {ElapsedMs}ms.",
            lookup.Requested, lookup.Found, lookup.Missing, lookup.Duplicates, lookup.Requests, aliasCount, stopwatch.ElapsedMilliseconds);

        return new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.Ok, Value = lookup };
    }
}

/// <summary>The result of a customer master lookup by producer code.</summary>
public sealed class CtrmCustomerLookup
{
    /// <summary>Requested (trimmed) code → its canonical master row. Case-insensitive.</summary>
    public Dictionary<string, CtrmCustomerDto> ByCode { get; } = new(StringComparer.OrdinalIgnoreCase);

    public int Requested { get; set; }
    public int Found { get; set; }
    public int Missing { get; set; }

    /// <summary>Codes that came back with more than one master row.</summary>
    public int Duplicates { get; set; }

    /// <summary>HTTP requests sent.</summary>
    public int Requests { get; set; }
}
