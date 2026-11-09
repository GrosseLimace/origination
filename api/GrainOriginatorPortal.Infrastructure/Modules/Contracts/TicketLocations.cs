// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Contracts;

/// <summary>
/// Fills in each ticket's display location. The ODS and CTRM ticket repositories and the field plan's
/// ticket reader all use it, so the location column is the same whichever source supplied the ticket.
/// </summary>
/// <remarks>
/// Resolves from <c>dbo.MbpLocationSynonym</c> (the MBPLOCSYN master):
/// <c>LocationId = "{OrganizationCode}-{ElevatorCode}"</c> -> <c>DisplayName</c> (e.g. 1075 + MADRID =>
/// "Madrid, NE"). ONLY tickets carrying BOTH an organization code AND an elevator code are matched; a ticket
/// with no elevator code, or with no matching row, is left blank. This fully replaces the former
/// vw_GNP026 / vw_GNP003 elevator lookup. DisplayName is already the full "City, ST" string the UI shows,
/// so it goes in ElevatorCity (ElevatorState left null) and renders verbatim on the unapplied / applied /
/// storage ticket views with no client change. CTRM has no equivalent of the location master.
/// </remarks>
public static class TicketLocations
{
    /// <param name="appContext">The Origination database, which holds the location master.</param>
    /// <param name="logger">Logger of the caller, so a failed lookup is logged under its own category.</param>
    /// <param name="tickets">Tickets to fill in, in place.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    public static async Task PopulateElevatorLocationsAsync(
        ApplicationDbContext appContext, ILogger logger, List<Ticket> tickets, CancellationToken cancellationToken)
    {
        // Only org+elevator tickets resolve; their key is "{Org}-{Elevator}", matched to LocationId.
        var keyed = tickets
            .Where(t => !string.IsNullOrWhiteSpace(t.OrganizationCode) && !string.IsNullOrWhiteSpace(t.ElevatorCode))
            .ToList();
        if (keyed.Count == 0) return;

        var locationIds = keyed
            .Select(t => $"{t.OrganizationCode!.Trim()}-{t.ElevatorCode!.Trim()}")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        try
        {
            var rows = await appContext.MbpLocationSynonyms
                .AsNoTracking()
                .Where(m => locationIds.Contains(m.LocationId) && m.DisplayName != null)
                .Select(m => new { m.LocationId, m.DisplayName })
                .ToListAsync(cancellationToken);

            var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in rows)
                if (!string.IsNullOrWhiteSpace(r.DisplayName))
                    lookup[r.LocationId.Trim()] = r.DisplayName!.Trim();

            foreach (var ticket in keyed)
            {
                var key = $"{ticket.OrganizationCode!.Trim()}-{ticket.ElevatorCode!.Trim()}";
                if (lookup.TryGetValue(key, out var display))
                {
                    // DisplayName is the full "City, ST" text → ElevatorCity (state left null) so the
                    // existing UI shows it verbatim. Unmatched tickets stay blank.
                    ticket.ElevatorCity = display;
                    ticket.ElevatorState = null;
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "MbpLocationSynonym location lookup failed — tickets will load without location display");
        }
    }
}
