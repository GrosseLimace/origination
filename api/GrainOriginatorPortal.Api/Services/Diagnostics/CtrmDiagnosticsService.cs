// System namespaces
using System.Text.Json;

// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Extracted verbatim from DiagnosticsController (audit finding
/// dotnet.diagnostics-controller-bypasses-service-layer). See the interface and the controller's
/// route remarks for why each probe is shaped the way it is.
/// </summary>
public sealed class CtrmDiagnosticsService : ICtrmDiagnosticsService
{
    private readonly ICtrmGraphQlClient _ctrm;
    private readonly IConfiguration _config;
    private readonly IContractRepository _contracts;
    private readonly ITicketRepository _tickets;
    private readonly CtrmProvenance _provenance;
    private readonly CtrmContractReader _contractReader;
    private readonly CtrmTicketReader _ticketReader;
    private readonly ApplicationDbContext _appContext;

    public CtrmDiagnosticsService(
        ICtrmGraphQlClient ctrm,
        IConfiguration config,
        IContractRepository contracts,
        ITicketRepository tickets,
        CtrmProvenance provenance,
        CtrmContractReader contractReader,
        CtrmTicketReader ticketReader,
        ApplicationDbContext appContext)
    {
        _ctrm = ctrm;
        _config = config;
        _contracts = contracts;
        _tickets = tickets;
        _provenance = provenance;
        _contractReader = contractReader;
        _ticketReader = ticketReader;
        _appContext = appContext;
    }

    // -------------------------------------------------------------------------
    /// <remarks>
    /// Uses a one-row <c>contracts</c> query rather than a schema introspection. Introspection was
    /// available when the API was first validated but the QA gateway now rejects it with
    /// <c>HC0046</c> ("Introspection is not allowed for the current request"), so a probe built on
    /// it would report a failure that says nothing about whether the integration works.
    ///
    /// A single-row data query proves more anyway: a valid token (auth), a reachable gateway
    /// (egress), AND that the API returns contract rows. Read the
    /// Status/Detail pair rather than the HTTP code — the client categorizes NotConfigured /
    /// TokenFailure / EgressBlocked / Unauthorized / Throttled separately because each has a
    /// different remediation.
    /// </remarks>
    public async Task<CtrmConnectivityResult> GetConnectivityAsync(CancellationToken cancellationToken)
    {
        // A fixed 30-day probe window. There is no configured contract window any more - every read is
        // scoped by producer - so this only has to be a range that reliably contains a row.
        var from = DateTime.Today.AddDays(-30).ToString("yyyy-MM-dd");
        var to = DateTime.Today.ToString("yyyy-MM-dd");

        const string document = """
            query ($from: Date!, $to: Date!) {
              contracts(skip: 0, take: 1, contractDateFrom: $from, contractDateTo: $to) {
                totalCount
                items { contractId contractPrefixType customerId contractDate priceTypeCode }
              }
            }
            """;

        var result = await _ctrm.QueryAsync<JsonElement>(document, new { from, to }, cancellationToken);

        int? totalCount = null;
        string? sampleContractId = null;
        if (result.Ok
            && result.Value is { ValueKind: JsonValueKind.Object } data
            && data.TryGetProperty("contracts", out var contracts)
            && contracts.ValueKind == JsonValueKind.Object)
        {
            if (contracts.TryGetProperty("totalCount", out var tc) && tc.TryGetInt32(out var tcVal))
                totalCount = tcVal;
            if (contracts.TryGetProperty("items", out var items)
                && items.ValueKind == JsonValueKind.Array
                && items.GetArrayLength() > 0
                && items[0].TryGetProperty("contractId", out var cid))
                sampleContractId = cid.GetString();
        }

        return new CtrmConnectivityResult
        {
            Configured = _ctrm.IsConfigured,
            Source = _config.GetValue<string>("Ctrm:Source"),
            Endpoint = _config.GetValue<string>("Ctrm:GraphQlUri"),
            Window = new CtrmProbeWindow(from, to),
            Status = result.Status.ToString(),
            HttpStatus = result.HttpStatus,
            ErrorCode = result.ErrorCode,
            Detail = result.Detail,
            TotalCountInWindow = totalCount,
            SampleContractId = sampleContractId,
            Healthy = result.Ok && totalCount is > 0
        };
    }

    // -------------------------------------------------------------------------
    /// <remarks>
    /// This exercises the whole chain the producer screen uses — switch, live reader, mapping, status
    /// calculation — rather than a raw query, so it catches the failures a connectivity probe cannot:
    /// a read that succeeds but contains no rows for this producer, or a customer-code mismatch.
    ///
    /// It also makes the ODS-vs-CTRM comparison cheap: call it, flip <c>Ctrm:Source</c>, call it
    /// again, and diff. No restart is needed because the switch re-reads config per call.
    /// </remarks>
    public async Task<CtrmProducerContractsResult> GetContractsForProducerAsync(string scoularId, CancellationToken cancellationToken)
    {
        var contracts = await _contracts.GetByCustomerAsync(0, scoularId, cancellationToken);
        var pricingLines = await _contracts.GetPricingLinesByCustomerAsync(scoularId, cancellationToken);

        return new CtrmProducerContractsResult
        {
            ScoularId = scoularId,
            ServedBy = _contracts is ContractRepositorySwitch { UsingCtrm: true } ? "ctrm" : "ods",
            ContractCount = contracts.Count,
            PricingLineCount = pricingLines.Count,
            // Enough per contract to eyeball parity against the screen without dumping everything.
            Contracts = contracts.Select(c => new CtrmProducerContractSummary
            {
                Id = c.Id,
                Synthetic = CtrmSyntheticId.IsSynthetic(c.Id),
                SourceContractId = c.SourceContractId,
                CtrmCustomerId = c.CtrmCustomerId,
                CommodityCode = c.CommodityCode,
                Quantity = c.Quantity,
                OpenBalanceQuantity = c.OpenBalanceQuantity,
                SettledQuantity = c.SettledQuantity,
                PriceTypeCode = c.PriceTypeCode,
                Status = c.Status.ToString(),
                ContractDate = c.ContractDate,
                DeliveryStart = c.DeliveryStart,
                DeliveryEnd = c.DeliveryEnd,
                ClosedDate = c.ClosedDate,
                CropYear = c.CropYear,
                CustomerConfirmStatus = c.CustomerConfirmStatus,
                HedgeMarketMonthDescription = c.HedgeMarketMonthDescription,
                PricingLines = pricingLines.Count(p => p.ContractId == c.SourceContractId)
            })
        };
    }

    // -------------------------------------------------------------------------
    /// <remarks>
    /// This decides the whole ticket strategy. The API has no customer filter, so a producer's
    /// tickets have to be read individually by composite key. If aliasing works, N key lookups
    /// collapse into ONE request; if it doesn't, they stay N sequential round trips at ~350ms
    /// each and the per-producer count has to be capped.
    ///
    /// Both aliases deliberately request the SAME known-good ticket — we are testing whether the
    /// server accepts the document shape, not whether the tickets exist.
    /// </remarks>
    public async Task<CtrmAliasBatchResult> GetAliasBatchSupportAsync(CancellationToken cancellationToken)
    {
        const string document = """
            query ($prefix: String!, $number: String!, $suffix: String!, $bl: Date!, $product: String!) {
              t1: ticket(ticketPrefix: $prefix, ticketNumber: $number, ticketSuffix: $suffix, ticketBLDate: $bl, productCode: $product) { ticketNumber }
              t2: ticket(ticketPrefix: $prefix, ticketNumber: $number, ticketSuffix: $suffix, ticketBLDate: $bl, productCode: $product) { ticketNumber }
            }
            """;

        var variables = new
        {
            prefix = "YMMU",
            number = "408279",
            suffix = "2",
            bl = "2024-12-31",
            product = "YSB"
        };

        var result = await _ctrm.QueryAsync<JsonElement>(document, variables, cancellationToken);

        var aliasesReturned = new List<string>();
        if (result.Ok && result.Value is { ValueKind: JsonValueKind.Object } data)
        {
            foreach (var property in data.EnumerateObject())
                aliasesReturned.Add(property.Name);
        }

        return new CtrmAliasBatchResult
        {
            Status = result.Status.ToString(),
            HttpStatus = result.HttpStatus,
            ErrorCode = result.ErrorCode,
            Detail = result.Detail,
            AliasesReturned = aliasesReturned,
            Supported = aliasesReturned.Contains("t1") && aliasesReturned.Contains("t2"),
            Meaning = aliasesReturned.Contains("t1") && aliasesReturned.Contains("t2")
                ? "Aliased batching works — a producer's tickets can be fetched in one request."
                : "Aliased batching did NOT work — ticket lookups stay one request each; cap the per-producer count."
        };
    }

    // -------------------------------------------------------------------------
    /// <remarks>
    /// <para>Every latency decision on the CTRM path so far has rested on hand-run probes, and two of them
    /// disagreed - one probe saw splitting a ticket window help, another saw it hurt. This exists so those
    /// questions can be settled against the real repository stack instead: the same caching, throttling,
    /// retry and mapping a click goes through, with a stopwatch and the provenance string per stage.</para>
    ///
    /// <para><c>cold=true</c> invalidates both readers for the producer first, which is the only honest way
    /// to measure a first click - otherwise the short per-producer cache answers and everything looks fast.
    /// Contracts and tickets run CONCURRENTLY because that is how the client fires them; measuring them in
    /// sequence would report a wall time no user experiences.</para>
    ///
    /// <para>No producer data in the response beyond row counts and the code that was asked for.</para>
    /// </remarks>
    public async Task<CtrmProducerTimingResult> GetProducerTimingAsync(string scoularId, bool cold, CancellationToken cancellationToken)
    {
        var code = scoularId;

        if (cold)
        {
            _contractReader.Invalidate(code);
            _ticketReader.Invalidate(code);
        }

        // The pacing read is the one stage keyed on our surrogate Id rather than the CTRM code: it
        // resolves the code itself from Customer, so passing 0 found nothing, recorded NoScoularId and
        // returned an empty list after a single DB lookup - a few milliseconds of fiction in the wall time.
        var customerId = await _appContext.Customers
            .AsNoTracking()
            .Where(c => c.ScoularId == code)
            .Select(c => (long?)c.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var stages = new List<CtrmTimingStage>();
        var wall = System.Diagnostics.Stopwatch.StartNew();

        // As the client fires them: the contract list and the ticket list at the same time.
        var contractsWatch = System.Diagnostics.Stopwatch.StartNew();
        var contractsTask = _contracts.GetByCustomerAsync(0, code, cancellationToken);
        var ticketsWatch = System.Diagnostics.Stopwatch.StartNew();
        var ticketsTask = _tickets.GetByCustomerAsync(0, code, cancellationToken);

        var contractRows = await Timed(contractsTask, contractsWatch);
        stages.Add(Stage("contracts", contractsWatch, contractRows, _provenance.Contracts));

        var ticketRows = await Timed(ticketsTask, ticketsWatch);
        stages.Add(Stage("tickets", ticketsWatch, ticketRows, _provenance.Tickets));

        // Then the two that follow on screen.
        if (customerId is { } id)
        {
            var pacingWatch = System.Diagnostics.Stopwatch.StartNew();
            var pacingRows = await Timed(_contracts.GetHistoricalForPacingAsync(id, cancellationToken), pacingWatch);
            stages.Add(Stage("pacing", pacingWatch, pacingRows, _provenance.Contracts));
        }
        else
        {
            // Said plainly rather than reported as a fast zero: this producer has no Origination row, so
            // the pacing card would not load for them either.
            stages.Add(Stage("pacing", null, rows: -1, provenance: "not measurable: no Customer row for this code"));
        }

        var linesWatch = System.Diagnostics.Stopwatch.StartNew();
        var lineRows = await Timed(_contracts.GetPricingLinesByCustomerAsync(code, cancellationToken), linesWatch);
        stages.Add(Stage("pricingLines", linesWatch, lineRows, _provenance.Contracts));

        wall.Stop();

        return new CtrmProducerTimingResult
        {
            ScoularId = code,
            CustomerId = customerId,
            Cold = cold,
            WallMs = wall.ElapsedMilliseconds,
            Stages = stages,
            Cache = new CtrmTimingCache(_contractReader.Describe(code), _ticketReader.Describe(code)),
            Failure = _provenance.Failure is { } f ? $"{f.What}:{f.Status}" : null,
            Partial = _provenance.Partial
        };
    }

    /// <summary>Awaits a stage, stopping its watch even when the read throws.</summary>
    private static async Task<int> Timed<T>(Task<List<T>> read, System.Diagnostics.Stopwatch watch)
    {
        try
        {
            var rows = await read;
            return rows.Count;
        }
        catch
        {
            // A 503 from the failure filter is a legitimate outcome to time; report it as -1 rather than
            // failing the whole measurement.
            return -1;
        }
        finally
        {
            watch.Stop();
        }
    }

    private static CtrmTimingStage Stage(string name, System.Diagnostics.Stopwatch? watch, int rows, string? provenance) =>
        new(name, watch?.ElapsedMilliseconds, rows, provenance);
}
