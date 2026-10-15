using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Mobile.Contracts;

namespace GrainOriginatorPortal.Mobile.Mapping;

/// <summary>
/// DP contract cards (card #648), ported from the desktop's <c>dp-aggregate.ts</c> and the DP table's contract level.
/// <c>ctrm.vw_GNTA70D1</c> emits one row per CHARGE TYPE per delivery, each repeating the delivery's quantity, so:
/// bushels are counted once per <see cref="DpContractResponse.TicketKey"/>; charges are additive across rows.
/// A null bushel figure is excluded from totals (never treated as the raw quantity) and disclosed as unconverted.
/// </summary>
public static class DpRollup
{
    private const string NoContract = "No contract";

    public static List<DpContractCardDto> ByContract(IEnumerable<DpContractResponse> rows) =>
        rows
            .GroupBy(r => string.IsNullOrWhiteSpace(r.ContractNumber) ? NoContract : r.ContractNumber.Trim())
            .Select(g => ToCard(g.Key, g.ToList()))
            // Oldest first by "Since", as the desktop orders contracts; the number breaks ties.
            .OrderBy(c => c.Since ?? DateTime.MaxValue)
            .ThenBy(c => c.ContractNumber, StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static DpContractCardDto ToCard(string contractNumber, List<DpContractResponse> rows)
    {
        // One row per physical delivery, keeping the first seen (id when the ticket key is somehow absent).
        var deliveries = rows
            .GroupBy(r => string.IsNullOrEmpty(r.TicketKey) ? r.Id : r.TicketKey)
            .Select(g => g.First())
            .ToList();

        var converted = deliveries.Where(d => d.Bushels is not null).ToList();
        decimal? bushels = converted.Count > 0 ? converted.Sum(d => d.Bushels!.Value) : null;
        var charges = rows.Sum(r => r.ReceivableAmount);
        var since = rows.Select(r => r.ChargedFromDate ?? r.StorageStartDate).Where(d => d is not null).Min();

        return new DpContractCardDto
        {
            Id = contractNumber,
            ContractNumber = contractNumber,
            Crop = rows.Select(r => r.Crop).FirstOrDefault(c => !string.IsNullOrWhiteSpace(c)) ?? "",
            TicketCount = deliveries.Count,
            Bushels = bushels,
            UnconvertedCount = deliveries.Count - converted.Count,
            Charges = charges,
            // Same figure the desktop shows as ¢/bu (total charges ÷ total bushels).
            ChargesPerBushel = bushels is > 0 ? Math.Round(charges / bushels.Value, 4) : null,
            Since = since,
            ChargedThruDate = rows.Select(r => r.ChargedThruDate).Where(d => d is not null).Max(),
            PaidThruDate = rows.Select(r => r.PaidThruDate).Where(d => d is not null).Max(),
            ChargeBreakdown = rows
                .GroupBy(r => string.IsNullOrWhiteSpace(r.StatusDescription) ? "Charges" : r.StatusDescription.Trim())
                .Select(g =>
                {
                    var rates = g.Select(r => r.StorageRate).Distinct().ToList();
                    return new DpChargeDto { Description = g.Key, Amount = g.Sum(r => r.ReceivableAmount), Rate = rates.Count == 1 ? rates[0] : null };
                })
                .OrderByDescending(c => c.Amount)
                .ToList(),
        };
    }
}
