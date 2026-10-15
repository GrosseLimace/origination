// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Mobile.Mapping;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// Card #648: DP cards are one per contract, rolled up the desktop's way (dp-aggregate.ts). The view emits one row
/// per charge type per delivery, so bushels count once per delivery and charges add across rows.
/// </summary>
public class MobileDpRollupTests
{
    private static DpContractResponse Row(string id, string ticketKey, string contract, decimal? bushels, decimal amount,
        string charge = "REGULAR STG RATE", decimal rate = 0.001667m, DateTime? from = null, DateTime? thru = null) => new()
    {
        Id = id, TicketKey = ticketKey, ContractNumber = contract, Crop = "Yellow Corn", Bushels = bushels, Quantity = bushels ?? 100,
        ReceivableAmount = amount, StatusDescription = charge, StorageRate = rate, ChargedFromDate = from, ChargedThruDate = thru,
    };

    [Fact]
    public void ByContract_CountsBushelsOncePerDelivery_AndAddsEveryChargeRow()
    {
        // Ticket 370145 from the desktop's notes: two charge rows for the same 812.5 bu.
        var cards = DpRollup.ByContract(
        [
            Row("1", "370145", "PL84649-A", 812.5m, 243.75m, "INITIAL CHARGE 2 - CHARGE/BU/D", 0.3m),
            Row("2", "370145", "PL84649-A", 812.5m, 170.66m),
        ]);

        var card = Assert.Single(cards);
        Assert.Equal(("PL84649-A", 1, 812.5m, 414.41m), (card.ContractNumber, card.TicketCount, card.Bushels, card.Charges));
        Assert.Equal(0.51m, Math.Round(card.ChargesPerBushel!.Value, 2));
        Assert.Equal(["INITIAL CHARGE 2 - CHARGE/BU/D", "REGULAR STG RATE"], card.ChargeBreakdown.Select(c => c.Description));
        Assert.Equal(0.3m, card.ChargeBreakdown[0].Rate);
    }

    [Fact]
    public void ByContract_LeavesUnconvertedDeliveriesOutOfBushels_AndSaysHowMany()
    {
        var cards = DpRollup.ByContract(
        [
            Row("1", "T1", "DP1", 500m, 10m),
            Row("2", "T2", "DP1", null, 20m),
        ]);

        var card = Assert.Single(cards);
        Assert.Equal((2, 500m, 1, 30m), (card.TicketCount, card.Bushels, card.UnconvertedCount, card.Charges));
    }

    [Fact]
    public void ByContract_HasNoBushelsWhenNothingConverts()
    {
        var card = Assert.Single(DpRollup.ByContract([Row("1", "T1", "DP1", null, 20m)]));

        Assert.Null(card.Bushels);
        Assert.Null(card.ChargesPerBushel);
    }

    [Fact]
    public void ByContract_OneCardPerContract_OldestFirst_WithNoContractFallback()
    {
        var cards = DpRollup.ByContract(
        [
            Row("1", "T1", "DP-NEW", 100m, 1m, from: new DateTime(2026, 9, 1)),
            Row("2", "T2", "DP-OLD", 100m, 1m, from: new DateTime(2026, 3, 1), thru: new DateTime(2026, 9, 30)),
            Row("3", "T3", "DP-OLD", 50m, 1m, from: new DateTime(2026, 4, 1), thru: new DateTime(2026, 10, 1)),
            Row("4", "T4", " ", 10m, 1m, from: new DateTime(2026, 10, 1)),
        ]);

        Assert.Equal(["DP-OLD", "DP-NEW", "No contract"], cards.Select(c => c.ContractNumber));
        Assert.Equal((2, 150m, new DateTime(2026, 3, 1), new DateTime(2026, 10, 1)),
            (cards[0].TicketCount, cards[0].Bushels, cards[0].Since, cards[0].ChargedThruDate));
    }

    [Fact]
    public void ByContract_DropsTheRateWhenDeliveriesDiffer()
    {
        var card = Assert.Single(DpRollup.ByContract(
        [
            Row("1", "T1", "DP1", 100m, 5m, rate: 0.0015m),
            Row("2", "T2", "DP1", 100m, 6m, rate: 0.0020m),
        ]));

        var charge = Assert.Single(card.ChargeBreakdown);
        Assert.Equal((11m, (decimal?)null), (charge.Amount, charge.Rate));
    }
}
