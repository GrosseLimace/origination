using System.Text.RegularExpressions;
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
/// <para><b>Two strategies, chosen by <c>CustomerSync:CustomerLookupStrategy</c> (plan E7).</b></para>
/// <list type="bullet">
/// <item><c>sourceCodes</c> (the default; anything but the literal <c>aliased</c>): one
/// <c>customers(sourceCodes:)</c> list filter per chunk, paged with skip/take. Measured on nonprod
/// 2026-10-06: 100 codes ≈ 5 s, all matched. The API limits the RENDERED filter (7,000 encoded characters),
/// not the number of values, so chunks are sized by <see cref="ChunkBySourceCodeFilterLength"/>.</item>
/// <item><c>aliased</c> (fallback only): <c>CustomerSync:CustomerAliasCount</c> aliased
/// <c>customers(sourceCode:)</c> fields per request. Measured ~27 s per 20 codes with HC0045 timeouts -
/// unusable at ~16,800 producers. Deleted one PROD release after sourceCodes is verified (plan E7b),
/// together with <see cref="CtrmCustomerQueries.CustomersBySourceCodesAliased"/> and
/// <c>CustomerSync:CustomerAliasCount</c>.</item>
/// </list>
/// <para>Either way <c>CustomerSync:CtrmConcurrency</c> chunks are in flight at once, every request behind
/// <see cref="CtrmTradeUnitThrottle"/> (so a nightly run stands aside for user clicks) and the HC0045
/// retry, and the same fail-closed rules apply.</para>
///
/// <para>Logs carry counts and timings - never customer names, phones or addresses. Producer codes
/// appear only in the duplicate-source-code line, at most ten of them.</para>
/// </remarks>
public sealed class CtrmCustomerReader
{
    public const string AliasCountKey = "CustomerSync:CustomerAliasCount";
    public const string ConcurrencyKey = "CustomerSync:CtrmConcurrency";
    public const string SourceSystemKey = "CustomerSync:CtrmSourceSystem";

    /// <summary><c>sourceCodes</c> (default) or <c>aliased</c> (fallback until plan E7b deletes it).</summary>
    public const string LookupStrategyKey = "CustomerSync:CustomerLookupStrategy";
    public const string AliasedStrategy = "aliased";
    public const string SourceCodesMaxFilterCharsKey = "CustomerSync:SourceCodesMaxFilterChars";
    public const string SourceCodesMaxPerRequestKey = "CustomerSync:SourceCodesMaxPerRequest";

    /// <summary>
    /// Bool, default false (plan E1): send <see cref="CtrmCustomerQueries.ExtendedCustomerProjection"/> instead of the
    /// base projection, in both strategies. Read once per lookup; the lookup reports what it fetched in
    /// <see cref="CtrmCustomerLookup.ExtendedFields"/>. An environment whose API lacks one of the fields fails the
    /// whole read closed (HTTP 400, <c>CUSTOMER_SYNC_SCHEMA_MISMATCH</c>), so turn it on only after
    /// <c>GET /api/diagnostics/customer-sync/ctrm-capabilities</c> lists every field there.
    /// </summary>
    public const string ExtendedFieldsKey = "CustomerSync:CtrmExtendedFields";

    /// <summary>Rows per page of a <c>customers(sourceCodes:)</c> request (the API's take ceiling).</summary>
    public const int SourceCodesPageSize = 500;

    /// <summary>
    /// Page cap per sourceCodes chunk. A chunk is at most 1,000 codes and normally ~375, so needing more than
    /// 20 × 500 rows means heavy duplication or a server that never stops paging - either way the read fails
    /// closed rather than walking on.
    /// </summary>
    public const int SourceCodesMaxPagesPerChunk = 20;

    /// <summary>
    /// Encoded characters each code costs in the rendered filter beyond its own encoded value: its two
    /// quotes and the separating comma, each URL-encoded to three characters (<c>%27 %27 %2C</c>). Matches
    /// the measurement: 500 seven-character codes rendered to 7,987 encoded characters ≈ 16 per code.
    /// </summary>
    public const int SourceCodeFilterOverhead = 9;

    /// <summary>
    /// Estimated URL-encoded filter characters one code costs: the code as it appears inside the quoted
    /// filter literal (an apostrophe is doubled), URL-encoded - a space is <c>%20</c>, an apostrophe
    /// <c>%27%27</c> - plus <see cref="SourceCodeFilterOverhead"/>. For an alphanumeric code this is just its
    /// length + 9; the API's 7,000 limit is on the ENCODED filter, so other characters must cost more.
    /// </summary>
    private static int EstimatedFilterCost(string code) =>
        Uri.EscapeDataString(code.Replace("'", "''", StringComparison.Ordinal)).Length + SourceCodeFilterOverhead;

    /// <summary>
    /// Splits <paramref name="codes"/> into sourceCodes chunks, greedily and in order: a chunk closes when the
    /// next code would push its estimated encoded filter length (Σ <see cref="EstimatedFilterCost"/>) past
    /// <paramref name="maxFilterChars"/>, or when it already holds <paramref name="maxPerRequest"/> codes.
    /// A single code longer than the budget still forms its own chunk - the API, not this estimate, has the
    /// final word, and a "too long" answer fails the read closed.
    /// </summary>
    /// <remarks>Public rather than internal only because Infrastructure exposes no internals to the test project.</remarks>
    public static List<IReadOnlyList<string>> ChunkBySourceCodeFilterLength(IReadOnlyList<string> codes, int maxFilterChars, int maxPerRequest)
    {
        ArgumentNullException.ThrowIfNull(codes);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxFilterChars, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxPerRequest, 1);

        var chunks = new List<IReadOnlyList<string>>();
        var current = new List<string>();
        var length = 0;
        foreach (var code in codes)
        {
            var cost = EstimatedFilterCost(code);
            if (current.Count > 0 && (length + cost > maxFilterChars || current.Count >= maxPerRequest))
            {
                chunks.Add(current);
                current = [];
                length = 0;
            }
            current.Add(code);
            length += cost;
        }
        if (current.Count > 0) chunks.Add(current);
        return chunks;
    }

    /// <summary>Carried in <see cref="CtrmReadResult{T}.ErrorCode"/> when an answer contains a row whose
    /// <c>sourceCode</c> is blank or was not asked for - by that alias (aliased), or by that chunk's
    /// <c>sourceCodes</c> list (default). Not a GraphQL error code: the API answered
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
    /// <see cref="CtrmReadStatus.Ok"/> - including <see cref="CtrmReadStatus.PartialSuccess"/> (an errored
    /// alias or page is a customer we do not have), an Ok answer missing an alias or its customers object, a
    /// sourceCodes chunk that hits <see cref="SourceCodesMaxPagesPerChunk"/>, and an answer carrying a row
    /// whose sourceCode was not requested (<see cref="FilterMismatchCode"/>) - fails the WHOLE read with
    /// <see cref="CtrmReadResult{T}.Value"/> null, and chunks not yet sent are cancelled.</para>
    ///
    /// <para>The failure detail names the cause an operator has to act on: the missing
    /// <c>Customers.Read.All</c> permission, a projection field or argument the API does not have (HTTP 400),
    /// or a sourceCodes filter the API says is too long (lower <c>CustomerSync:SourceCodesMaxFilterChars</c>).</para>
    /// </remarks>
    public async Task<CtrmReadResult<CtrmCustomerLookup>> GetBySourceCodesAsync(
        IReadOnlyCollection<string> sourceCodes, CancellationToken cancellationToken)
    {
        // The 7-character limit is a customerIds defect, not a sourceCode one - keep every code.
        var codes = CtrmCustomerCodes.NormalizeKeepingAll(sourceCodes);
        var extended = CtrmConfig.ReadBool(_configuration, ExtendedFieldsKey, false);
        var lookup = new CtrmCustomerLookup { Requested = codes.Count, ExtendedFields = extended };
        if (codes.Count == 0)
            return new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.Ok, Value = lookup };

        var concurrency = Math.Clamp(CtrmConfig.ReadInt(_configuration, ConcurrencyKey, 2), 1, 8);
        var sourceSystem = _configuration[SourceSystemKey]?.Trim();
        if (string.IsNullOrEmpty(sourceSystem)) sourceSystem = null;

        List<IReadOnlyList<string>> chunks;
        string shape;
        Func<int, IReadOnlyList<string>, Action, CancellationToken, Task<ChunkOutcome>> readChunk;
        if (string.Equals(_configuration[LookupStrategyKey]?.Trim(), AliasedStrategy, StringComparison.OrdinalIgnoreCase))
        {
            var aliasCount = Math.Clamp(CtrmConfig.ReadInt(_configuration, AliasCountKey, 20), 1, 50);
            chunks = [.. codes.Chunk(aliasCount).Select(c => (IReadOnlyList<string>)c.ToList())];
            shape = $"aliased, up to {aliasCount} alias(es) per request";
            readChunk = (index, chunk, countRequest, token) => ReadAliasedChunkAsync(index, chunk, sourceSystem, extended, countRequest, token);
        }
        else
        {
            var maxFilterChars = Math.Clamp(CtrmConfig.ReadInt(_configuration, SourceCodesMaxFilterCharsKey, 6000), 500, 7000);
            var maxPerRequest = Math.Clamp(CtrmConfig.ReadInt(_configuration, SourceCodesMaxPerRequestKey, 400), 1, 1000);
            chunks = ChunkBySourceCodeFilterLength(codes, maxFilterChars, maxPerRequest);
            shape = $"sourceCodes, filter budget {maxFilterChars} chars and at most {maxPerRequest} code(s) per chunk";
            readChunk = (index, chunk, countRequest, token) => ReadSourceCodesChunkAsync(index, chunk, sourceSystem, extended, countRequest, token);
        }
        if (extended) shape += "; extended fields";

        var stopwatch = Stopwatch.StartNew();
        var (results, failed, requests) = await ReadChunksAsync(chunks, concurrency, readChunk, cancellationToken);

        if (failed is not null)
            return Fail(failed, shape, chunks.Count, codes.Count, requests, stopwatch.ElapsedMilliseconds);

        var duplicateCodes = new List<string>();
        foreach (var (code, items) in results!)
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
            "CTRM customer lookup: {Requested} code(s), {Found} found, {Missing} missing, {Duplicates} with duplicate rows, via {Requests} request(s) in {Chunks} chunk(s) ({Strategy}) in {ElapsedMs}ms.",
            lookup.Requested, lookup.Found, lookup.Missing, lookup.Duplicates, lookup.Requests, chunks.Count, shape, stopwatch.ElapsedMilliseconds);

        return new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.Ok, Value = lookup };
    }

    /// <summary>One chunk's rows (requested code → its rows, in request order), or the failure that fails the read.</summary>
    private readonly record struct ChunkOutcome(
        List<(string Code, List<CtrmCustomerDto> Items)>? Rows,
        CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>>? Failure);

    /// <summary>
    /// Runs every chunk, at most <paramref name="concurrency"/> at once; the first failure is recorded and
    /// cancels the chunks still waiting or in flight. <c>Rows</c> is null exactly when <c>Failure</c> is set.
    /// </summary>
    private static async Task<(List<(string Code, List<CtrmCustomerDto> Items)>? Rows, ChunkFailure? Failure, int Requests)> ReadChunksAsync(
        IReadOnlyList<IReadOnlyList<string>> chunks,
        int concurrency,
        Func<int, IReadOnlyList<string>, Action, CancellationToken, Task<ChunkOutcome>> readChunk,
        CancellationToken cancellationToken)
    {
        using var slot = new SemaphoreSlim(concurrency, concurrency);
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var requests = 0;
        ChunkFailure? firstFailure = null;

        void Record(int index, CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>> failure)
        {
            Interlocked.CompareExchange(ref firstFailure, new ChunkFailure(index, failure), null);
            stop.Cancel();
        }

        void CountRequest() => Interlocked.Increment(ref requests);

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

                ChunkOutcome outcome;
                try
                {
                    outcome = await readChunk(index, chunk, CountRequest, stop.Token);
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

                if (outcome.Failure is { } failure)
                {
                    Record(index, failure);
                    return null;
                }
                return outcome.Rows;
            }
            finally
            {
                slot.Release();
            }
        }

        var results = await Task.WhenAll(chunks.Select((chunk, index) => One(index, chunk)));

        return Volatile.Read(ref firstFailure) is { } failed
            ? (null, failed, Volatile.Read(ref requests))
            : ([.. results.SelectMany(r => r!)], null, Volatile.Read(ref requests));
    }

    /// <summary>The aliased fallback: one request per chunk, alias <c>c{i}</c> = <c>chunk[i]</c>. Deleted in plan E7b.</summary>
    private async Task<ChunkOutcome> ReadAliasedChunkAsync(
        int index, IReadOnlyList<string> chunk, string? sourceSystem, bool extended, Action countRequest, CancellationToken token)
    {
        countRequest();
        var document = CtrmCustomerQueries.CustomersBySourceCodesAliased(chunk, sourceSystem, extended);
        var read = await CtrmTradeUnitThrottle.RunAsync(_configuration, () => CtrmServerTimeoutRetry.RunAsync(
            () => _client.QueryAsync<Dictionary<string, CtrmPage<CtrmCustomerDto>>>(document, null, token),
            _configuration, _logger, $"customers chunk {index}"));
        var (rows, failure) = MapChunk(read, chunk);
        return new ChunkOutcome(rows, failure);
    }

    /// <summary>
    /// The default: <see cref="CtrmCustomerQueries.CustomersBySourceCodes"/> for the whole chunk, paged until
    /// <c>hasNextPage</c> is false. Every page - and every HC0045 re-send - is counted as a request.
    /// </summary>
    private async Task<ChunkOutcome> ReadSourceCodesChunkAsync(
        int index, IReadOnlyList<string> chunk, string? sourceSystem, bool extended, Action countRequest, CancellationToken token)
    {
        var document = CtrmCustomerQueries.CustomersBySourceCodesDocument(extended);

        // Requested code (as sent) → its rows. Case and padding on the returned sourceCode are tolerated
        // (Db2 CHAR columns); a row for any code this chunk did not ask for is not.
        var byCode = new Dictionary<string, List<CtrmCustomerDto>>(chunk.Count, StringComparer.OrdinalIgnoreCase);
        foreach (var code in chunk) byCode[code] = [];
        var received = 0;

        for (var page = 0; ; page++)
        {
            if (page == SourceCodesMaxPagesPerChunk)
                return new ChunkOutcome(null, new()
                {
                    Status = CtrmReadStatus.Error,
                    Detail = $"customers(sourceCodes:) for {chunk.Count} code(s) still reported hasNextPage after {SourceCodesMaxPagesPerChunk} pages of {SourceCodesPageSize} rows (page cap CtrmCustomerReader.SourceCodesMaxPagesPerChunk); that many rows for so few codes means heavy duplication or a paging fault, so nothing from this read is trusted."
                });

            var skip = page * SourceCodesPageSize;
            // An unprovided variable leaves the argument absent, so sourceSystem is sent only when configured.
            object variables = sourceSystem is null
                ? new { codes = chunk, skip, take = SourceCodesPageSize }
                : new { codes = chunk, sourceSystem, skip, take = SourceCodesPageSize };
            var read = await CtrmTradeUnitThrottle.RunAsync(_configuration, () => CtrmServerTimeoutRetry.RunAsync(
                () =>
                {
                    countRequest();
                    return _client.QueryAsync<Dictionary<string, CtrmPage<CtrmCustomerDto>>>(document, variables, token);
                },
                _configuration, _logger, $"customers sourceCodes chunk {index} page {page}"));

            if (read.Status == CtrmReadStatus.PartialSuccess)
                return new ChunkOutcome(null, read with { Status = CtrmReadStatus.QueryError, Value = null, Detail = "partial answer (data plus errors): " + read.Detail });
            if (read.Status != CtrmReadStatus.Ok)
                return new ChunkOutcome(null, read with { Value = null });
            if (read.Value is not { } data || !data.TryGetValue("customers", out var customers) || customers is null)
                return new ChunkOutcome(null, new()
                {
                    Status = CtrmReadStatus.Error, HttpStatus = read.HttpStatus,
                    Detail = $"CTRM returned no customers object for a sourceCodes request for {chunk.Count} code(s)."
                });
            if (customers.PageInfo is null)
                return new ChunkOutcome(null, new()
                {
                    Status = CtrmReadStatus.Error, HttpStatus = read.HttpStatus,
                    Detail = $"CTRM returned no pageInfo for a sourceCodes request for {chunk.Count} code(s), so completeness cannot be established."
                });

            var items = customers.Items ?? [];
            var stray = items.Count(d => d.SourceCode?.Trim() is not { Length: > 0 } returned || !byCode.ContainsKey(returned));
            if (stray > 0)
                return new ChunkOutcome(null, new()
                {
                    Status = CtrmReadStatus.Error, HttpStatus = read.HttpStatus, ErrorCode = FilterMismatchCode,
                    Detail = $"a sourceCodes request for {chunk.Count} code(s) returned {stray} of {items.Count} row(s) whose sourceCode is blank or was not among the codes that request asked for; the sourceCodes filter is no longer an exact match, so nothing from this read is trusted."
                });

            foreach (var item in items) byCode[item.SourceCode!.Trim()].Add(item);
            received += items.Count;

            if (!customers.PageInfo.HasNextPage)
            {
                // skip/take carries no explicit order, so an unstable server order can skip a row between pages
                // without any page looking wrong. The last page's totalCount is the only check: fewer rows than
                // it is a hole, which would deactivate a customer. More than it is harmless (counted as seen).
                if (received < customers.TotalCount)
                    return new ChunkOutcome(null, new()
                    {
                        Status = CtrmReadStatus.Error, HttpStatus = read.HttpStatus,
                        Detail = $"sourceCodes chunk returned {received} row(s) but the API reported totalCount {customers.TotalCount} — paging was incomplete"
                    });
                return new ChunkOutcome([.. chunk.Select(code => (code, byCode[code]))], null);
            }
        }
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
    /// does the full <see cref="CtrmCustomerQueries.CustomerProjection"/> come back? With
    /// <see cref="ExtendedFieldsKey"/> on, the sample is read with the extended projection, so
    /// <see cref="CtrmCustomerProbe.ProjectionAccepted"/> then covers the extended fields too.
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

    // -------------------------------------------------------------------------
    // Onboarding search (plan E3)

    /// <summary>Rows requested per alias in the onboarding search: the API's page ceiling.</summary>
    public const int SearchTake = 500;

    /// <summary>Candidates returned at most. A type-ahead, matching the ODS search's TOP 50.</summary>
    public const int SearchMaxResults = 50;

    /// <summary>A single token of 3 to 7 non-blank characters is also tried as a partial producer code.</summary>
    private static readonly Regex CodeLike = new(@"^\S{3,7}$", RegexOptions.Compiled);

    /// <summary>
    /// The add-customer search against the CTRM customer master (plan E3): producers whose name contains the
    /// longest word of the term, plus, for a single short token, producers whose code contains it. The server
    /// restricts to <c>industryCode1 = PR</c>; in memory the rows must pass <see cref="Sync.CtrmCustomerFilters.IsInScope"/>,
    /// not be MDM duplicates, and contain EVERY word of the term in the name or the code (the ODS search's
    /// multi-word AND). One row per source code (<see cref="PickCanonical"/>), ordered by name, capped at
    /// <see cref="SearchMaxResults"/>. Interactive: a user is typing, so it takes the interactive lane and the
    /// short server-timeout budget. Never returns a partial answer as Ok.
    /// </summary>
    public async Task<CtrmReadResult<CtrmCustomerSearch>> SearchAsync(string searchTerm, CancellationToken cancellationToken)
    {
        var words = (searchTerm ?? string.Empty)
            .Split([' ', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();
        var search = new CtrmCustomerSearch
        {
            ExtendedFields = string.Equals(_configuration[ExtendedFieldsKey]?.Trim(), "true", StringComparison.OrdinalIgnoreCase)
        };
        if (words.Count == 0)
            return new CtrmReadResult<CtrmCustomerSearch> { Status = CtrmReadStatus.Ok, Value = search };

        var nameTerm = words.OrderByDescending(w => w.Length).First();
        var codeTerm = words.Count == 1 && CodeLike.IsMatch(words[0]) ? words[0] : null;
        var sourceSystem = _configuration[SourceSystemKey]?.Trim();

        var document = CtrmCustomerQueries.CustomersSearch(byCode: codeTerm is not null, search.ExtendedFields, SearchTake);
        var variables = new Dictionary<string, object?> { ["name"] = nameTerm };
        if (codeTerm is not null) variables["code"] = codeTerm;
        if (!string.IsNullOrEmpty(sourceSystem)) variables["sourceSystem"] = sourceSystem;

        var stopwatch = Stopwatch.StartNew();
        CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>> read;
        using (CtrmTradeUnitThrottle.Interactive())
        {
            read = await CtrmServerTimeoutRetry.RunAsync(
                () => _client.QueryAsync<Dictionary<string, CtrmPage<CtrmCustomerDto>>>(document, variables, cancellationToken),
                _configuration, _logger, "customers onboarding search", interactive: true);
        }

        if (read.Status == CtrmReadStatus.PartialSuccess)
            return new CtrmReadResult<CtrmCustomerSearch>
            {
                Status = CtrmReadStatus.QueryError, HttpStatus = read.HttpStatus, ErrorCode = read.ErrorCode,
                Detail = "partial answer (data plus errors): " + read.Detail
            };
        if (!read.Ok || read.Value is null)
            return new CtrmReadResult<CtrmCustomerSearch>
            {
                Status = read.Ok ? CtrmReadStatus.Error : read.Status, HttpStatus = read.HttpStatus, ErrorCode = read.ErrorCode,
                Detail = read.Detail ?? "CTRM returned no data for the onboarding search."
            };

        var rows = new List<CtrmCustomerDto>();
        foreach (var alias in codeTerm is null ? new[] { "byName" } : new[] { "byName", "byCode" })
        {
            if (!read.Value.TryGetValue(alias, out var page) || page is null)
                return new CtrmReadResult<CtrmCustomerSearch>
                {
                    Status = CtrmReadStatus.Error, HttpStatus = read.HttpStatus,
                    Detail = $"CTRM returned no '{alias}' customers object for the onboarding search."
                };
            rows.AddRange(page.Items ?? []);
            if (page.TotalCount > SearchTake) search.Truncated = true;
        }
        search.Received = rows.Count;

        var kept = rows
            .Where(dto => Sync.CtrmCustomerFilters.IsInScope(dto, out _) && !dto.IsDuplicate && EveryWordMatches(dto, words))
            .GroupBy(dto => dto.SourceCode!.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(group => PickCanonical(group.ToList()))
            .Where(dto => dto is not null)
            .Select(dto => dto!)
            .OrderBy(dto => dto.Name?.Trim(), StringComparer.OrdinalIgnoreCase)
            .ThenBy(dto => dto.SourceCode?.Trim(), StringComparer.OrdinalIgnoreCase)
            .Take(SearchMaxResults);
        search.Items.AddRange(kept);

        // Counts only: the term and the names are producer data.
        _logger.LogInformation(
            "CTRM onboarding search: {Kept} candidate(s) from {Received} row(s) ({Aliases} alias(es), truncated={Truncated}) in {Ms} ms.",
            search.Items.Count, search.Received, codeTerm is null ? 1 : 2, search.Truncated, stopwatch.ElapsedMilliseconds);

        return new CtrmReadResult<CtrmCustomerSearch> { Status = CtrmReadStatus.Ok, HttpStatus = read.HttpStatus, Value = search };
    }

    private static bool EveryWordMatches(CtrmCustomerDto dto, IReadOnlyList<string> words)
    {
        var name = dto.Name ?? string.Empty;
        var code = dto.SourceCode ?? string.Empty;
        return words.All(w => name.Contains(w, StringComparison.OrdinalIgnoreCase) || code.Contains(w, StringComparison.OrdinalIgnoreCase));
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

    private CtrmReadResult<CtrmCustomerLookup> Fail(ChunkFailure failed, string shape, int chunkCount, int codeCount, int requests, long elapsedMs)
    {
        var chunk = failed.Read;
        var (logCode, prefix) = Classify(chunk);
        var detail = prefix + chunk.Detail;
        var logDetail = detail.Length > MaxLoggedDetail ? detail[..MaxLoggedDetail] + "…" : detail;

        _logger.LogWarning(
            "CTRM customer lookup failed [{ErrorCode}] [{ErrorCategory}]: chunk {Chunk} of {Chunks} ({Strategy}; {Codes} code(s), {Requests} request(s) sent) answered {Status} (HTTP {HttpStatus}, GraphQL code {GraphQlCode}) after {ElapsedMs}ms; the whole read fails closed. {Detail}",
            logCode, "Integration", failed.Index, chunkCount, shape, codeCount, requests, chunk.Status, chunk.HttpStatus, chunk.ErrorCode, elapsedMs, logDetail);

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
                "filter mismatch — customers(sourceCode:/sourceCodes:) returned rows for a sourceCode that was not requested; see CtrmCustomerQueries.CustomersBySourceCodes / CustomersBySourceCodesAliased: ");
        if (IsPermissionMissing(chunk.Status, chunk.ErrorCode))
            return ("CUSTOMER_SYNC_NO_PERMISSION",
                "customers permission missing — Customers.Read.All (or ReadCustomersBasic) is not granted to this client: ");
        if (CtrmServerTimeoutRetry.IsServerTimeout(chunk))
            return ("CUSTOMER_SYNC_SOURCE_UNAVAILABLE",
                "CTRM server timeout (HC0045) persisted after the configured retries — the gateway is slow, not a schema problem: ");
        if (IsFilterTooLong(chunk))
            return ("CUSTOMER_SYNC_SOURCE_UNAVAILABLE",
                "sourceCodes filter too long for the API — lower CustomerSync:SourceCodesMaxFilterChars: ");
        if (chunk.Status == CtrmReadStatus.QueryError && chunk.HttpStatus == 400)
            return ("CUSTOMER_SYNC_SCHEMA_MISMATCH",
                "schema mismatch — a field or argument in CtrmCustomerQueries.CustomerProjection (or ExtendedFieldsProjection when CustomerSync:CtrmExtendedFields is on) / CustomersBySourceCodes / CustomersBySourceCodesAliased does not exist on the API (HTTP 400): ");
        return ("CUSTOMER_SYNC_SOURCE_UNAVAILABLE", "");
    }

    /// <summary>
    /// The API's answer to a rendered filter over its limit (measured 2026-10-06: HTTP 200, <c>VALIDATION</c>,
    /// "The filter is too long for the Profisee endpoint (7987 encoded characters, limit 7000)"). Not a schema
    /// problem: the chunk estimate undershot, and the operator's lever is a smaller filter budget.
    /// </summary>
    private static bool IsFilterTooLong<T>(CtrmReadResult<T> chunk) =>
        !chunk.Ok
        && string.Equals(chunk.ErrorCode, "VALIDATION", StringComparison.OrdinalIgnoreCase)
        && (chunk.Detail?.Contains("too long", StringComparison.OrdinalIgnoreCase) ?? false);

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

/// <summary>The result of the onboarding search (plan E3): in-scope, non-duplicate producers matching the term.</summary>
public sealed class CtrmCustomerSearch
{
    /// <summary>At most <see cref="CtrmCustomerReader.SearchMaxResults"/> rows, one per source code, ordered by name.</summary>
    public List<CtrmCustomerDto> Items { get; } = [];

    /// <summary>True when an alias reported more rows than one page holds, so the result is the first page's best, not everything.</summary>
    public bool Truncated { get; set; }

    /// <summary>True when the extended projection was sent, so the rows carry the extended fields.</summary>
    public bool ExtendedFields { get; set; }

    /// <summary>Rows received before filtering, for the log line.</summary>
    public int Received { get; set; }
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

    /// <summary>
    /// True when this lookup sent the extended projection (<see cref="CtrmCustomerReader.ExtendedFieldsKey"/>), so
    /// the rows in <see cref="ByCode"/> carry the extended fields. The sync applies the extended columns only then.
    /// </summary>
    public bool ExtendedFields { get; set; }
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
