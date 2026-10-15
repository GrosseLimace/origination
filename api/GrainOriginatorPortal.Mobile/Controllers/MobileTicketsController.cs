using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Filters;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>Ticket roll-up (card #646): operation <c>getTicketSummary</c>. Count and bushels per group; no line items.</summary>
[Route(RoutePrefix + "/customers/{customerId:long}/tickets")]
[RequireTradeUnitEntitlement]
public sealed class MobileTicketsController : MobileControllerBase
{
    public const string UnappliedKey = "unapplied";

    private readonly ITicketService _tickets;
    private readonly ICustomerService _customers;
    private readonly ICommodityService _commodities;

    public MobileTicketsController(ITicketService tickets, ICustomerService customers, ICommodityService commodities)
    {
        _tickets = tickets;
        _customers = customers;
        _commodities = commodities;
    }

    /// <param name="cropYear">Optional; filters by the ticket's date year (the ODS view carries no crop-year column).</param>
    [HttpGet("summary")]
    [ProducesResponseType(typeof(TicketSummaryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TicketSummaryDto>> GetSummary(long customerId, [FromQuery] int? cropYear, CancellationToken cancellationToken)
    {
        var customer = await _customers.GetByIdAsync(customerId, cancellationToken)
                       ?? throw new NotFoundException("Customer", customerId);

        var tickets = await _tickets.GetByCustomerAsync(customerId, customer.ScoularId, cancellationToken);
        var conversions = await _commodities.GetConversionsAsync(cancellationToken);
        var lbsPerBushel = conversions
            .Where(c => c.LbsPerUnit > 0 && !string.IsNullOrWhiteSpace(c.CommodityCode))
            .GroupBy(c => c.CommodityCode.Trim().ToUpperInvariant())
            .ToDictionary(g => g.Key, g => g.First().LbsPerUnit);

        return Ok(Summarise(tickets.Where(t => t.IsActive), cropYear, lbsPerBushel));
    }

    internal static TicketSummaryDto Summarise(IEnumerable<TicketResponse> tickets, int? cropYear, IReadOnlyDictionary<string, decimal> lbsPerBushel)
    {
        var filtered = tickets
            .Where(t => cropYear is null || t.ParsedDate?.Year == cropYear)
            .ToList();

        var groups = filtered
            .GroupBy(t => t.IsApplied && !string.IsNullOrWhiteSpace(t.CtrmContractNumber) ? t.CtrmContractNumber! : UnappliedKey)
            .Select(g => new TicketGroupDto
            {
                Key = g.Key,
                ContractId = g.Key == UnappliedKey ? null : g.Select(t => t.ContractId).FirstOrDefault(id => id.HasValue),
                CommodityCode = g.Select(t => t.ProductCode).FirstOrDefault(p => !string.IsNullOrWhiteSpace(p)),
                TicketCount = g.Count(),
                Bushels = TotalBushels(g, lbsPerBushel),
                LastTicketDate = g.Max(t => t.ParsedDate),
            })
            .OrderBy(g => g.Key == UnappliedKey ? 1 : 0)
            .ThenByDescending(g => g.LastTicketDate ?? DateTime.MinValue)
            .ToList();

        return new TicketSummaryDto
        {
            TotalTickets = filtered.Count,
            TotalBushels = TotalBushels(filtered, lbsPerBushel),
            Groups = groups,
        };
    }

    /// <summary>
    /// The desktop's rule (tickets-table toBushels): each ticket's net weight in pounds (AppliedDockQuantity — ODS
    /// AppliedNetQuantity / CTRM applied net) divided by its own commodity's pounds per bushel (vw_GNP024), so
    /// mixed-commodity groups total correctly. Null when any ticket's commodity has no factor (shown as "—", as the
    /// desktop does); a ticket with no weight counts as 0. (Before 2026-10-15 this used the load-level unload quantity, which
    /// is not divided among producers — wrong for a shared load.)
    /// </summary>
    private static decimal? TotalBushels(IEnumerable<TicketResponse> tickets, IReadOnlyDictionary<string, decimal> lbsPerBushel)
    {
        decimal total = 0;
        foreach (var t in tickets)
        {
            var code = (t.ProductCode ?? string.Empty).Trim().ToUpperInvariant();
            if (!lbsPerBushel.TryGetValue(code, out var factor) || factor <= 0) return null;
            total += (t.AppliedDockQuantity ?? 0) / factor; // a ticket with no weight counts as 0, as on the desktop
        }
        return Math.Round(total, 2);
    }
}
