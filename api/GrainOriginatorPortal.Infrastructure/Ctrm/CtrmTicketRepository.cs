using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Serves a producer's tickets from CTRM.
/// </summary>
/// <remarks>
/// <para>Per-producer reads go live through <see cref="CtrmTicketReader"/>, using the <c>customerId</c>
/// filter. Unlike contracts, tickets still need a date range — the header carries no customer, so the
/// range is what bounds the scan — which the reader handles by slicing a three-year lookback into
/// consecutive windows within the server's 366-day cap.</para>
///
/// <para>Nothing on this surface reads ODS. Location names and storage gating are deliberately absent:
/// CTRM has no place names and no storage entity, so filling them from ODS would make the screen look
/// complete while destroying the measurement of what CTRM can actually supply.</para>
/// </remarks>
public sealed class CtrmTicketRepository : ITicketRepository
{
    private readonly CtrmTicketReader _reader;
    private readonly CtrmTicketSnapshot _snapshot;
    private readonly ApplicationDbContext _appContext;
    private readonly TicketRepository _ods;
    private readonly CtrmProvenance _provenance;
    private readonly ILogger<CtrmTicketRepository> _logger;

    public CtrmTicketRepository(
        CtrmTicketReader reader,
        CtrmTicketSnapshot snapshot,
        ApplicationDbContext appContext,
        TicketRepository ods,
        CtrmProvenance provenance,
        ILogger<CtrmTicketRepository> logger)
    {
        _reader = reader;
        _snapshot = snapshot;
        _appContext = appContext;
        _ods = ods;
        _provenance = provenance;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // Live per-producer reads
    // -------------------------------------------------------------------------

    /// <inheritdoc />
    public async Task<List<Ticket>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var code = await ResolveScoularIdAsync(customerId, scoularId, cancellationToken);
        if (code is null)
        {
            _provenance.RecordTickets("ctrm", "NoScoularId", 0);
            return [];
        }

        var read = await _reader.GetForProducerAsync(code, cancellationToken);
        if (!read.Ok)
        {
            // No ODS fallback: serving ODS tickets while the screen is meant to show CTRM would hide the
            // failure and invalidate any conclusion drawn about CTRM's coverage.
            _logger.LogError("CTRM tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordTickets("ctrm", read.Status.ToString(), 0);
            return [];
        }

        var tickets = (read.Value ?? [])
            .SelectMany(header => CtrmMappings.ToTickets(header, code))
            .OrderByDescending(t => t.Date)
            .ToList();

        _provenance.RecordTickets("ctrm", "Ok", tickets.Count);

        _logger.LogInformation("CTRM tickets: {Count} rows for producer {ScoularId} (live).", tickets.Count, code);

        return tickets;
    }

    /// <inheritdoc />
    /// <remarks>
    /// The same live set narrowed by the contract-number prefix rule the entity itself applies, so the two
    /// tabs cannot disagree about what "unapplied" means. Shares the reader's cached request rather than
    /// issuing a second one.
    /// </remarks>
    public async Task<List<Ticket>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var all = await GetByCustomerAsync(customerId, scoularId, cancellationToken);
        return all.Where(t => !t.IsApplied).ToList();
    }

    /// <summary>
    /// One contract's applied tickets, filtered from the ticket window snapshot.
    /// </summary>
    /// <remarks>
    /// Cannot use the live reader: this method is keyed by contract id, and with no contract filter on
    /// <c>tickets</c> there is no way to know which producer to ask for. Not reached from the producer
    /// screen — the client's Applied Tickets section filters the already-loaded producer ticket list in
    /// the browser rather than calling the API.
    /// </remarks>
    public async Task<List<Ticket>> GetAppliedByContractAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        var id = sourceContractId?.Trim();
        if (string.IsNullOrEmpty(id))
        {
            _provenance.RecordTickets("ctrm", "NoContractId", 0);
            return [];
        }

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok)
        {
            if (snapshot.Status == CtrmReadStatus.Warming)
                _logger.LogInformation("CTRM applied tickets: snapshot still warming — {Detail}", snapshot.Detail);
            else
                _logger.LogError("CTRM applied tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                    "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", snapshot.Status, snapshot.Detail);

            _provenance.RecordTickets("ctrm", snapshot.Status.ToString(), 0);
            return [];
        }

        var tickets = snapshot.Tickets
            .SelectMany(header => CtrmMappings.ToTicketsForContract(header, id))
            .OrderByDescending(t => t.Date)
            .ToList();

        _provenance.RecordTickets("ctrm", "Ok", tickets.Count);
        return tickets;
    }

    // -------------------------------------------------------------------------
    // Other screens — ODS
    // -------------------------------------------------------------------------

    /// <summary>Delegated. Trade-unit-wide, not part of the producer screen's ticket surface.</summary>
    public Task<List<Ticket>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("TradeUnitWide", _ods.GetAsync(tradeUnits, cancellationToken));

    /// <summary>Delegated. Feeds preload/insights, not the producer profile.</summary>
    public Task<List<Ticket>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("Todays", _ods.GetTodaysAsync(tradeUnits, cancellationToken));

    /// <summary>Delegated. CTRM exposes no farm concept.</summary>
    public Task<List<Ticket>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => DelegateAsync("ByFarm", _ods.GetByFarmAsync(farmId, cancellationToken));

    /// <summary>
    /// Delegated by design: storage lives in <c>ctrm.vw_GNTA39D1</c> on ODS and CTRM has no storage
    /// entity. Exposed for callers that gate their own ticket sets; the CTRM producer read does NOT
    /// apply it, so C-prefix tickets show ungated there.
    /// </summary>
    public Task<Dictionary<string, HashSet<string>>> GetActiveStorageCommoditiesAsync(
        IReadOnlyCollection<string> customerCodes, CancellationToken cancellationToken)
        => _ods.GetActiveStorageCommoditiesAsync(customerCodes, cancellationToken);

    /// <inheritdoc />
    public List<Ticket> GateCustomerStorageTickets(List<Ticket> tickets, Dictionary<string, HashSet<string>> storageByCustomer)
        => _ods.GateCustomerStorageTickets(tickets, storageByCustomer);

    // -------------------------------------------------------------------------

    private async Task<List<Ticket>> DelegateAsync(string reason, Task<List<Ticket>> odsRead)
    {
        var tickets = await odsRead;
        _provenance.RecordTickets("ods", $"delegated:{reason}", tickets.Count);
        return tickets;
    }

    private async Task<string?> ResolveScoularIdAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(scoularId)) return scoularId.Trim();

        var resolved = await _appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => c.ScoularId)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(resolved))
        {
            _logger.LogWarning("CTRM tickets: customer {CustomerId} not found or has no ScoularId.", customerId);
            return null;
        }

        return resolved.Trim();
    }
}
