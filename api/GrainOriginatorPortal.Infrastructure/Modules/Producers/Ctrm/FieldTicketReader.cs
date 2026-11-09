using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Ctrm;
using GrainOriginatorPortal.Infrastructure.Platform.Ctrm;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;

/// <summary>
/// A field's tickets as CTRM has them: every detail row delivered under the split ID, settled or not, with
/// the crop year of each contract they're applied to.
/// </summary>
/// <param name="Tickets">One row per detail row under the split, every party's (cancelled and consolidated rows dropped).</param>
/// <param name="ContractCropYears">Contract number (trimmed, upper-case) → CTRM crop year, for the contracts of every party on the split's tickets.</param>
public sealed record FieldTicketRead(IReadOnlyList<Ticket> Tickets, IReadOnlyDictionary<string, int> ContractCropYears);

/// <summary>Reads the CTRM tickets delivered under one split ID, for the field plan's 45Z review.</summary>
public interface IFieldTicketReader
{
    /// <summary>A failed CTRM read comes back as a failed result, never as "no tickets".</summary>
    Task<CtrmReadResult<FieldTicketRead>> ReadAsync(long customerId, string splitId, CancellationToken cancellationToken);
}

/// <summary>
/// A split ID isn't a ticket customer (<c>tickets(customerId: split)</c> returns nothing). Each detail row of a
/// split ticket names its party in <c>customerCode</c> (the producer, or a partner such as a landlord) and the
/// split in <c>combinedCustomerId</c>. So the producer's tickets are read, over the configured lookback, and every
/// row with the field's split ID is kept, whichever party it's for and whatever the split percentage (user
/// decision 2026-11-03). A split row only a partner holds, on a ticket with no row for the producer, isn't
/// reached: <c>tickets</c> has no split filter. Unlike the producer ticket screens, nothing is gated: stored and
/// settled grain counts toward the field's CI. Contract crop years come from the CTRM contracts of each party on
/// those rows; a contract none of them holds leaves the ticket to the date window. Locations come from
/// <see cref="TicketLocations"/>, as on every ticket read.
/// </summary>
public sealed class CtrmFieldTicketReader : IFieldTicketReader
{
    private readonly CtrmTicketReader _tickets;
    private readonly CtrmContractReader _contracts;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<CtrmFieldTicketReader> _logger;

    public CtrmFieldTicketReader(CtrmTicketReader tickets, CtrmContractReader contracts,
        ApplicationDbContext appContext, ILogger<CtrmFieldTicketReader> logger)
    {
        _tickets = tickets;
        _contracts = contracts;
        _appContext = appContext;
        _logger = logger;
    }

    public async Task<CtrmReadResult<FieldTicketRead>> ReadAsync(long customerId, string splitId, CancellationToken cancellationToken)
    {
        var producer = await CtrmProducerCode.ResolveAsync(_appContext, _logger, "field tickets", customerId, null, cancellationToken);
        if (producer is null)
            return new CtrmReadResult<FieldTicketRead> { Status = CtrmReadStatus.Error, Detail = $"No producer code for customer {customerId}." };

        var read = await _tickets.GetForSplitProducerAsync(producer, cancellationToken);
        if (!read.Ok)
            return new CtrmReadResult<FieldTicketRead> { Status = read.Status, HttpStatus = read.HttpStatus, Detail = read.Detail, ErrorCode = read.ErrorCode };

        var tickets = (read.Value ?? []).SelectMany(h => CtrmMappings.ToTicketsForSplit(h, splitId)).ToList();

        var years = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var parties = tickets.Select(t => t.CustomerCode).Prepend(producer).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase);
        foreach (var code in parties)
        {
            // Crop years only refine the match, so a contract read that fails leaves its tickets to the date window.
            var contracts = await _contracts.GetForProducerCoreAsync(code, cancellationToken);
            if (!contracts.Ok)
            {
                _logger.LogWarning("Field tickets: contracts for {Code} unavailable ({Status}); using the date window for its tickets", code, contracts.Status);
                continue;
            }
            foreach (var c in contracts.Value ?? [])
                if (c.ContractNumber?.Trim() is { Length: > 0 } number && c.CropYear is { } year)
                    years.TryAdd(number.ToUpperInvariant(), year);
        }

        try
        {
            await TicketLocations.PopulateElevatorLocationsAsync(_appContext, _logger, tickets, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Locations are display-only; the review still works without them.
            _logger.LogWarning(ex, "Field tickets: elevator locations unavailable for {SplitId}", splitId);
        }

        return new CtrmReadResult<FieldTicketRead> { Status = CtrmReadStatus.Ok, Value = new FieldTicketRead(tickets, years) };
    }
}
