using System.Diagnostics;
using System.Text.Json;
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
/// <para>Logs carry counts and timings - never customer names, phones or addresses. Producer codes
/// appear only in the duplicate-source-code line, at most ten of them.</para>
/// </remarks>
public sealed class CtrmCustomerReader
{
    public const string AliasCountKey = "CustomerSync:CustomerAliasCount";
    public const string ConcurrencyKey = "CustomerSync:CtrmConcurrency";
    public const string SourceSystemKey = "CustomerSync:CtrmSourceSystem";

    /// <summary>Carried in <see cref="CtrmReadResult{T}.ErrorCode"/> when an aliased answer contains a row whose
    /// <c>sourceCode</c> is not the one that alias asked for. Not a GraphQL error code: the API answered
    /// cleanly, but its <c>sourceCode</c> filter is no longer an exact match, so the whole read is refused —
    /// trusting it would copy another producer's master data onto ours, and the guard would never notice.</summary>
    public const string FilterMismatchCode = "CUSTOMER_SYNC_FILTER_MISMATCH";

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
    /// <remarks>
    /// <para><b>Fails closed.</b> The nightly sync deactivates every customer this lookup does not return,
    /// so a shorter dictionary is never an acceptable answer. The first chunk that is not a clean
    /// <see cref="CtrmReadStatus.Ok"/> - including <see cref="CtrmReadStatus.PartialSuccess"/>, where an
    /// errored alias is a customer we do not have, an Ok answer missing an alias, and an answer whose rows do
    /// not carry the requested sourceCode (<see cref="FilterMismatchCode"/>) - fails the WHOLE read
    /// with <see cref="CtrmReadResult{T}.Value"/> null, and chunks not yet sent are cancelled.</para>
    ///
    /// <para>The failure detail names the cause an operator has to act on: the missing
    /// <c>Customers.Read.All</c> permission (not granted to our clients yet, so the first thing Dev sees),
    /// or a projection field the API does not have (HTTP 400).</para>
    /// </remarks>
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
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var stopwatch = Stopwatch.StartNew();
        var requests = 0;
        ChunkFailure? firstFailure = null;

        void Record(int index, CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>> failure)
        {
            Interlocked.CompareExchange(ref firstFailure, new ChunkFailure(index, failure), null);
            stop.Cancel();
        }

        // Null = not sent, or abandoned, because another chunk had already failed the read (or this one
        // failed and recorded itself).
        async Task<List<(string Code, List<CtrmCustomerDto> Items)>?> One(int index, IReadOnlyList<string> chunk)
        {
            try
            {
                await slot.WaitAsync(stop.Token);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
            {
                return null;
            }

            try
            {
                if (stop.IsCancellationRequested) return null;

                Interlocked.Increment(ref requests);
                var document = CtrmCustomerQueries.CustomersBySourceCodesAliased(chunk, sourceSystem);
                CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>> read;
                try
                {
                    read = await CtrmTradeUnitThrottle.RunAsync(_configuration, () => CtrmServerTimeoutRetry.RunAsync(
                        () => _client.QueryAsync<Dictionary<string, CtrmPage<CtrmCustomerDto>>>(document, null, stop.Token),
                        _configuration, _logger, $"customers chunk {index}"));
                }
                catch (OperationCanceledException) when (stop.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
                {
                    return null;    // our own stop, after another chunk failed - that failure is already recorded
                }
                catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
                {
                    // Cancelled by something other than the caller or our own stop - typically an HTTP
                    // timeout surfacing as TaskCanceledException. A failure, never a silently missing chunk.
                    Record(index, new()
                    {
                        Status = CtrmReadStatus.Error,
                        Detail = $"the customers request was cancelled without the caller cancelling it (likely an HTTP timeout): {ex.Message}"
                    });
                    return null;
                }

                var (rows, failure) = MapChunk(read, chunk);
                if (failure is not null)
                {
                    Record(index, failure);
                    return null;
                }
                return rows;
            }
            finally
            {
                slot.Release();
            }
        }

        var results = await Task.WhenAll(chunks.Select((chunk, index) => One(index, chunk)));

        if (Volatile.Read(ref firstFailure) is { } failed)
            return Fail(failed, chunks.Count, codes.Count, Volatile.Read(ref requests), stopwatch.ElapsedMilliseconds);

        var duplicateCodes = new List<string>();
        foreach (var (code, items) in results.SelectMany(r => r!))
        {
            if (items.Count == 0)
            {
                lookup.Missing++;
                continue;
            }
            if (items.Count > 1)
            {
                lookup.Duplicates++;
                duplicateCodes.Add(code);
            }
            lookup.ByCode[code] = items.Count == 1 ? items[0] : PickCanonical(items)!;
        }
        lookup.Found = lookup.ByCode.Count;
        lookup.Requests = requests;

        if (duplicateCodes.Count > 0)
        {
            // Codes only (at most 10) - never names.
            _logger.LogWarning(
                "CTRM customer lookup [{ErrorCode}] [{ErrorCategory}]: {Count} source code(s) returned more than one master row; kept the canonical row (active, then MDM master, then lowest id). First {Shown}: {Codes}",
                "CUSTOMER_SYNC_DUPLICATE_SOURCE_CODE", "Integration", duplicateCodes.Count, Math.Min(10, duplicateCodes.Count),
                string.Join(", ", duplicateCodes.Take(10)));
        }

        _logger.LogInformation(
            "CTRM customer lookup: {Requested} code(s), {Found} found, {Missing} missing, {Duplicates} with duplicate rows, via {Requests} request(s) of up to {AliasCount} alias(es) in {ElapsedMs}ms.",
            lookup.Requested, lookup.Found, lookup.Missing, lookup.Duplicates, lookup.Requests, aliasCount, stopwatch.ElapsedMilliseconds);

        return new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.Ok, Value = lookup };
    }

    /// <summary>
    /// The one row to keep when a <c>sourceCode</c> has several MDM rows: active first, then the MDM master
    /// record, then the lowest id text (ordinal) so the choice is stable night to night.
    /// </summary>
    public static CtrmCustomerDto? PickCanonical(IReadOnlyList<CtrmCustomerDto> candidates)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        return candidates
            .OrderByDescending(c => c.ActiveYN?.Trim().Equals("Y", StringComparison.OrdinalIgnoreCase) == true)
            .ThenByDescending(c => CtrmYesNo.IsYes(c.MdmMasterRecord))
            .ThenBy(c => c.IdText, StringComparer.Ordinal)
            .FirstOrDefault();
    }

    /// <summary>
    /// Diagnostic probe: is the <c>customers</c> field readable by this client, and - given a sample code -
    /// does the full <see cref="CtrmCustomerQueries.CustomerProjection"/> come back?
    /// </summary>
    /// <remarks>
    /// The first request is the cheapest possible <c>customers</c> read. Only when it shows the permission
    /// granted is the sample looked up through <see cref="GetBySourceCodesAsync"/>, which exercises the
    /// exact document the nightly sync sends. <see cref="CtrmReadResult{T}.Value"/> is always populated so
    /// the caller can report the permission even when the read failed; <c>Status</c>/<c>Detail</c> carry the
    /// first failure seen.
    /// </remarks>
    public async Task<CtrmReadResult<CtrmCustomerProbe>> ProbeAsync(string? sampleSourceCode, CancellationToken cancellationToken)
    {
        var probe = new CtrmCustomerProbe();
        var read = await _client.QueryAsync<JsonElement>(CtrmCustomerQueries.CustomersProbe, null, cancellationToken);
        probe.Permission = DescribePermission(read);
        probe.TotalCount = TotalCountOf(read);

        if (probe.Permission != "granted")
        {
            var (_, prefix) = Classify(read);
            return new CtrmReadResult<CtrmCustomerProbe>
            {
                // A probe that came back with data plus an AUTH_ error must not read as Ok.
                Status = read.Status == CtrmReadStatus.PartialSuccess ? CtrmReadStatus.QueryError : read.Status,
                HttpStatus = read.HttpStatus, ErrorCode = read.ErrorCode, Detail = prefix + read.Detail, Value = probe
            };
        }

        var sample = sampleSourceCode?.Trim();
        if (string.IsNullOrEmpty(sample))
            return new CtrmReadResult<CtrmCustomerProbe>
            {
                Status = read.Status, HttpStatus = read.HttpStatus, ErrorCode = read.ErrorCode, Detail = read.Detail, Value = probe
            };

        var lookup = await GetBySourceCodesAsync([sample], cancellationToken);
        probe.ProjectionAccepted = lookup.Ok;
        if (!lookup.Ok)
        {
            if (DescribePermission(lookup) == "missing") probe.Permission = "missing";
            return new CtrmReadResult<CtrmCustomerProbe>
            {
                Status = lookup.Status, HttpStatus = lookup.HttpStatus, ErrorCode = lookup.ErrorCode, Detail = lookup.Detail, Value = probe
            };
        }

        if (lookup.Value!.ByCode.TryGetValue(sample, out var row))
        {
            probe.SampleFound = true;
            probe.IdKind = row.Id.ValueKind.ToString();
        }

        return new CtrmReadResult<CtrmCustomerProbe>
        {
            Status = read.Status, HttpStatus = read.HttpStatus, ErrorCode = read.ErrorCode, Detail = read.Detail, Value = probe
        };
    }

    private static int? TotalCountOf(CtrmReadResult<JsonElement> read) =>
        read.Ok
        && read.Value.ValueKind == JsonValueKind.Object
        && read.Value.TryGetProperty("customers", out var customers)
        && customers.ValueKind == JsonValueKind.Object
        && customers.TryGetProperty("totalCount", out var total)
        && total.TryGetInt32(out var count)
            ? count
            : null;

    /// <summary>Longest failure detail written into the log line; the result keeps the full text.</summary>
    private const int MaxLoggedDetail = 500;

    private sealed record ChunkFailure(int Index, CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>> Read);

    /// <summary>
    /// Maps one chunk's answer onto its codes (alias <c>c{i}</c> is <c>chunk[i]</c>), or returns the failure
    /// that fails the whole read. Anything short of a clean, complete answer is a failure.
    /// </summary>
    private static (List<(string Code, List<CtrmCustomerDto> Items)>? Rows, CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>>? Failure) MapChunk(
        CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>> read, IReadOnlyList<string> chunk)
    {
        // Data plus errors is not "mostly fine" for a lookup whose gaps become deactivations. Reported as
        // QueryError so the result can never read as Ok while carrying no dictionary.
        if (read.Status == CtrmReadStatus.PartialSuccess)
            return (null, read with { Status = CtrmReadStatus.QueryError, Value = null, Detail = "partial answer (data plus errors): " + read.Detail });
        if (read.Status != CtrmReadStatus.Ok)
            return (null, read with { Value = null });
        if (read.Value is not { } pages)
            return (null, new() { Status = CtrmReadStatus.Error, HttpStatus = read.HttpStatus, Detail = "CTRM returned no data for an aliased customers request." });

        var rows = new List<(string Code, List<CtrmCustomerDto> Items)>(chunk.Count);
        for (var i = 0; i < chunk.Count; i++)
        {
            if (!pages.TryGetValue($"c{i}", out var page) || page is null)
                return (null, new()
                {
                    Status = CtrmReadStatus.Error, HttpStatus = read.HttpStatus,
                    Detail = $"CTRM returned no customers object for alias c{i} of an aliased request for {chunk.Count} code(s)."
                });

            // Case and padding are tolerated (Db2 CHAR columns); nothing else is.
            var items = page.Items ?? [];
            var stray = items.Count(d => !string.Equals(d.SourceCode?.Trim(), chunk[i], StringComparison.OrdinalIgnoreCase));
            if (stray > 0)
                return (null, new()
                {
                    Status = CtrmReadStatus.Error, HttpStatus = read.HttpStatus, ErrorCode = FilterMismatchCode,
                    Detail = $"alias c{i} asked for sourceCode {chunk[i]} but {stray} of {items.Count} returned row(s) carry a different or blank sourceCode; the sourceCode filter is no longer an exact match, so nothing from this read is trusted."
                });

            rows.Add((chunk[i], items));
        }
        return (rows, null);
    }

    private CtrmReadResult<CtrmCustomerLookup> Fail(ChunkFailure failed, int chunkCount, int codeCount, int requests, long elapsedMs)
    {
        var chunk = failed.Read;
        var (logCode, prefix) = Classify(chunk);
        var detail = prefix + chunk.Detail;
        var logDetail = detail.Length > MaxLoggedDetail ? detail[..MaxLoggedDetail] + "…" : detail;

        _logger.LogWarning(
            "CTRM customer lookup failed [{ErrorCode}] [{ErrorCategory}]: chunk {Chunk} of {Chunks} ({Codes} code(s), {Requests} request(s) sent) answered {Status} (HTTP {HttpStatus}, GraphQL code {GraphQlCode}) after {ElapsedMs}ms; the whole read fails closed. {Detail}",
            logCode, "Integration", failed.Index, chunkCount, codeCount, requests, chunk.Status, chunk.HttpStatus, chunk.ErrorCode, elapsedMs, logDetail);

        return new CtrmReadResult<CtrmCustomerLookup>
        {
            Status = chunk.Status,
            HttpStatus = chunk.HttpStatus,
            ErrorCode = chunk.ErrorCode,
            Detail = detail,
            Value = null
        };
    }

    /// <summary>The log code and the operator-facing detail prefix for a failed chunk.</summary>
    private static (string LogCode, string Prefix) Classify<T>(CtrmReadResult<T> chunk)
    {
        if (chunk.Status == CtrmReadStatus.Error && chunk.ErrorCode == FilterMismatchCode)
            return (FilterMismatchCode,
                "filter mismatch — customers(sourceCode:) returned rows for a different sourceCode; see CtrmCustomerQueries.CustomersBySourceCodesAliased: ");
        if (IsPermissionMissing(chunk.Status, chunk.ErrorCode))
            return ("CUSTOMER_SYNC_NO_PERMISSION",
                "customers permission missing — Customers.Read.All (or ReadCustomersBasic) is not granted to this client: ");
        if (CtrmServerTimeoutRetry.IsServerTimeout(chunk))
            return ("CUSTOMER_SYNC_SOURCE_UNAVAILABLE",
                "CTRM server timeout (HC0045) persisted after the configured retries — the gateway is slow, not a schema problem: ");
        if (chunk.Status == CtrmReadStatus.QueryError && chunk.HttpStatus == 400)
            return ("CUSTOMER_SYNC_SCHEMA_MISMATCH",
                "schema mismatch — a field or argument in CtrmCustomerQueries.CustomerProjection / CustomersBySourceCodesAliased does not exist on the API (HTTP 400): ");
        return ("CUSTOMER_SYNC_SOURCE_UNAVAILABLE", "");
    }

    /// <summary>
    /// Whether a read shows the <c>customers</c> permission (<c>Customers.Read.All</c>) as granted:
    /// <c>"missing"</c> on an APIM 401/403 or a Hot Chocolate <c>AUTH_*</c> error, <c>"granted"</c> when the
    /// read came back with data, otherwise <c>"unknown"</c> (the read failed for a reason that says nothing
    /// about the permission).
    /// </summary>
    public static string DescribePermission<T>(CtrmReadResult<T> result)
    {
        ArgumentNullException.ThrowIfNull(result);
        if (IsPermissionMissing(result.Status, result.ErrorCode)) return "missing";
        return result.Ok ? "granted" : "unknown";
    }

    private static bool IsPermissionMissing(CtrmReadStatus status, string? errorCode) =>
        status == CtrmReadStatus.Unauthorized
        || (errorCode?.StartsWith("AUTH_", StringComparison.OrdinalIgnoreCase) ?? false);
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

/// <summary>What the customers permission/projection probe found. Never carries a customer value.</summary>
public sealed class CtrmCustomerProbe
{
    /// <summary>"granted" | "missing" | "unknown" - see <see cref="CtrmCustomerReader.DescribePermission{T}"/>.</summary>
    public string Permission { get; set; } = "unknown";
    public int? TotalCount { get; set; }

    /// <summary>True when the full <see cref="CtrmCustomerQueries.CustomerProjection"/> came back for the sample.</summary>
    public bool ProjectionAccepted { get; set; }
    public bool SampleFound { get; set; }

    /// <summary>
    /// JSON type of the sample row's <c>id</c> ("Number" | "String"; null when no sample was found). The
    /// first Dev probe records what <c>customers.id</c> is, so nobody later swaps the minted-id band for it
    /// without knowing why the band exists. Never the value itself.
    /// </summary>
    public string? IdKind { get; set; }
}
