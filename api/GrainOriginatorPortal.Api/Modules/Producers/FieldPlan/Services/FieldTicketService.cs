using System.Globalization;
using System.Text.Json;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Interfaces;

namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Services;

/// <summary>
/// The CTRM tickets behind a field's 45Z review: every party's row delivered under the field's split ID
/// (CTRM's <c>combinedCustomerId</c>; the producer's and any partner's, whatever the split percentage), for its
/// crop, in its crop year, settled or not. CTRM tickets carry no crop year, so (user decision 2026-10-29) a ticket on a
/// contract takes the contract's crop year, and any other ticket counts when its BL date falls in the crop
/// year's window: <c>FieldPlan:TicketWindow:{crop}</c> From/To as MM-dd, default 08-01 to 07-31 of the next
/// year. The originator can still leave any ticket out when confirming, or add one of the split's other
/// tickets for the crop (<see cref="FieldTicketsResponse.Others"/>, decision 2026-10-30) when the crop year
/// rule missed it. A ticket another of the field's confirmed CIs already counts is marked and can't be added.
/// </summary>
public interface IFieldTicketService
{
    Task<FieldTicketsResponse> ForRecordAsync(int recordId, CancellationToken ct);

    /// <summary>The same tickets for a record already loaded (with its season and field).</summary>
    Task<FieldTicketsResponse> ForRecordAsync(FieldProgramRecord record, CancellationToken ct);
}

public sealed class FieldTicketService : IFieldTicketService
{
    private const string DefaultFrom = "08-01", DefaultTo = "07-31";

    private readonly IFieldPlanRepository _repository;
    private readonly IFieldTicketReader _reader;
    private readonly ICommodityRepository _commodities;
    private readonly IConfiguration _configuration;

    public FieldTicketService(IFieldPlanRepository repository, IFieldTicketReader reader, ICommodityRepository commodities, IConfiguration configuration)
    {
        _repository = repository;
        _reader = reader;
        _commodities = commodities;
        _configuration = configuration;
    }

    public async Task<FieldTicketsResponse> ForRecordAsync(int recordId, CancellationToken ct) =>
        await ForRecordAsync(await _repository.GetRecordAsync(recordId, ct) ?? throw new NotFoundException("Program record", recordId), ct);

    public async Task<FieldTicketsResponse> ForRecordAsync(FieldProgramRecord record, CancellationToken ct)
    {
        var season = record.Season!;
        var field = season.Field!;
        var cropCode = await _repository.GetPlantingIntentionCropAsync(season.PlantingIntentionId, ct);
        var categories = (await _commodities.GetActiveAsync(ct))
            .GroupBy(c => c.Code.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Category, StringComparer.OrdinalIgnoreCase);
        string? GroupOf(string? code) => FieldPlanCropGroups.For(code, code is null ? null : categories.GetValueOrDefault(code.Trim()));
        var group = GroupOf(cropCode) ?? FieldPlanCropGroups.ForLabel(season.CropLabel);
        var (from, to) = Window(group, season.CropYear);

        var read = await _reader.ReadAsync(field.CustomerId, field.SplitId, ct);
        if (!read.Ok)
            throw new InfrastructureException(
                $"The field's tickets could not be read from CTRM ({read.Status}). Please retry shortly.", "INFRASTRUCTURE_CTRM_UNAVAILABLE");

        var lbsPerUnit = (await _commodities.GetConversionsAsync(ct))
            .Where(c => c.LbsPerUnit > 0)
            .GroupBy(c => c.CommodityCode.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().LbsPerUnit, StringComparer.OrdinalIgnoreCase);

        // Tickets the field's other confirmed CIs already count (any year), so none is counted twice. Matched
        // on the key and on the ticket number: the key includes the BL date and product, which CTRM can correct.
        var confirmedFor = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var other in await _repository.GetConfirmedRecordsForFieldAsync(field.Id, ct))
            if (other.Id != record.Id)
                foreach (var id in ConfirmedTicketIds(other.Official))
                    confirmedFor.TryAdd(id, other.Season!.CropYear);

        var tickets = new List<FieldTicketResponse>();
        var others = new List<FieldTicketResponse>();
        foreach (var t in read.Value!.Tickets)
        {
            // The crop: the same group as the crop row, or the same code when the crop isn't one we know.
            var sameCrop = group is not null
                ? GroupOf(t.ProductCode) == group
                : string.Equals(t.ProductCode?.Trim(), cropCode?.Trim(), StringComparison.OrdinalIgnoreCase);
            if (!sameCrop) continue;

            var bl = DateOnly.TryParseExact(t.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : (DateOnly?)null;
            string match;
            string? note = null;
            if (t.CtrmContractNumber?.Trim().ToUpperInvariant() is { Length: > 0 } number && read.Value.ContractCropYears.TryGetValue(number, out var contractYear))
            {
                match = contractYear == season.CropYear ? "contract" : "other";
                if (match == "other") note = $"On a {contractYear} contract";
            }
            else if (bl is { } date && date >= from && date <= to)
                match = "window";
            else
            {
                match = "other";
                note = bl is null ? "No BL date" : $"BL date outside {from:M/d/yy}–{to:M/d/yy}";
            }

            var key = t.Id.ToString(CultureInfo.InvariantCulture);
            var ticketNumber = (t.ShipmentTicketNumber ?? $"{t.TicketPrefix}{t.TicketNumber}{t.TicketSuffix}").Trim();
            int? countedIn = confirmedFor.TryGetValue(key, out var byKey) ? byKey
                : confirmedFor.TryGetValue(NumberId(ticketNumber), out var byNumber) ? byNumber : null;
            (match == "other" ? others : tickets).Add(new FieldTicketResponse
            {
                TicketKey = key,
                TicketNumber = ticketNumber,
                CustomerCode = t.CustomerCode,
                BlDate = bl?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Location = Location(t),
                ProductCode = t.ProductCode,
                ContractNumber = t.CtrmContractNumber,
                CropYearMatch = match,
                Note = note,
                ConfirmedFor = countedIn,
                NetBushels = Bushels(t, lbsPerUnit),
                Settled = t.FinalSettledDate is not null || string.Equals(t.TicketStatusDescription?.Trim(), "Final Settled", StringComparison.OrdinalIgnoreCase),
                SettledDate = t.FinalSettledDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Status = t.TicketStatusDescription,
            });
        }

        return new FieldTicketsResponse
        {
            SplitId = field.SplitId,
            CropYear = season.CropYear,
            CropGroup = group,
            WindowFrom = from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            WindowTo = to.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            Tickets = tickets.OrderBy(t => t.BlDate).ThenBy(t => t.TicketNumber, StringComparer.Ordinal).ToList(),
            Others = others.OrderByDescending(t => t.BlDate).ThenBy(t => t.TicketNumber, StringComparer.Ordinal).ToList(),
        };
    }

    /// <summary>A confirmed result's tickets, each as its key and as its ticket number (see <see cref="NumberId"/>).</summary>
    private static IEnumerable<string> ConfirmedTicketIds(string? official)
    {
        if (official is null) yield break;
        using var doc = JsonDocument.Parse(official);
        if (!doc.RootElement.TryGetProperty("tickets", out var list) || list.ValueKind != JsonValueKind.Array) yield break;
        foreach (var t in list.EnumerateArray())
        {
            if (t.TryGetProperty("ticketKey", out var key) && key.ValueKind == JsonValueKind.String) yield return key.GetString()!;
            if (t.TryGetProperty("ticketNumber", out var number) && number.ValueKind == JsonValueKind.String) yield return NumberId(number.GetString()!);
        }
    }

    /// <summary>A ticket number, prefixed so it never collides with a key.</summary>
    private static string NumberId(string ticketNumber) => "#" + ticketNumber.Trim();

    /// <summary>The crop year's BL-date window: From in the crop year, To in the next year when it falls earlier in the calendar.</summary>
    internal (DateOnly From, DateOnly To) Window(string? group, int cropYear)
    {
        var section = group is null ? null : _configuration.GetSection($"FieldPlan:TicketWindow:{group}");
        var (fm, fd) = MonthDay(section?["From"], DefaultFrom);
        var (tm, td) = MonthDay(section?["To"], DefaultTo);
        var from = new DateOnly(cropYear, fm, fd);
        var to = new DateOnly(cropYear, tm, td);
        if (to < from) to = to.AddYears(1);
        return (from, to);
    }

    private static (int Month, int Day) MonthDay(string? value, string fallback)
    {
        var text = string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        // Parsed against 2001, not a leap year, so 02-29 is refused: it has no date in most crop years.
        return DateOnly.TryParseExact($"2001-{text}", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? (d.Month, d.Day)
            : throw new InvalidOperationException($"FieldPlan:TicketWindow values are MM-dd, not '{text}'.");
    }

    /// <summary>
    /// The split's net pounds in bushels, by ODS's conversion for the product code. No conversion, no figure:
    /// as everywhere in the portal (DpBushelConversion), a bushel number is never guessed. Such a ticket shows
    /// "?" in the review and can't be confirmed.
    /// </summary>
    private static decimal? Bushels(Ticket t, IReadOnlyDictionary<string, decimal> lbsPerUnit) =>
        t.AppliedDockQuantity is { } pounds && t.ProductCode is { } code && lbsPerUnit.TryGetValue(code.Trim(), out var factor) && factor > 0
            ? Math.Round(pounds / factor, 2)
            : null;

    private static string? Location(Ticket t)
    {
        var place = string.Join(", ", new[] { t.ElevatorCity?.Trim(), t.ElevatorState?.Trim() }.Where(s => !string.IsNullOrEmpty(s)));
        var code = t.ElevatorCode?.Trim();
        return (place, code) switch
        {
            ({ Length: > 0 }, { Length: > 0 }) => $"{place} ({code})",
            ({ Length: > 0 }, _) => place,
            (_, { Length: > 0 }) => code,
            _ => null,
        };
    }
}
