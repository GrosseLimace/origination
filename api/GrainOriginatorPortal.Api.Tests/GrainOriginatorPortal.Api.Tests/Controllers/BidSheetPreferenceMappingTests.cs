// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// The preference write carries eleven optional fields, four of them adjacent nullable strings
/// holding JSON. Until recently it travelled as twelve POSITIONAL parameters through the controller,
/// the service and the repository, and the controller fanned a request out into them by position.
///
/// Nothing about that was type-safe. Inserting a field in the wrong slot compiled clean and wrote one
/// JSON blob into another column -- silently replacing, say, every user's print layout with their
/// column list the first time they touched the grid. The record that replaced it makes the mapping
/// checkable, and these tests are what check it: each field is sent alone and asserted to arrive in
/// its own property, so a transposition fails here rather than in someone's saved settings.
/// </summary>
public class BidSheetPreferenceMappingTests
{
    private const string GlobalKey = "__global__";

    /// <summary>Captures the update the controller hands the service, without touching a database.</summary>
    private static (BidSheetController Controller, Func<BidSheetPreferenceUpdate?> Captured) CreateSut()
    {
        BidSheetPreferenceUpdate? captured = null;
        var service = new Mock<IBidSheetService>();
        service.Setup(s => s.SetPreferenceAsync(It.IsAny<BidSheetPreferenceUpdate>(), It.IsAny<CancellationToken>()))
            .Callback<BidSheetPreferenceUpdate, CancellationToken>((u, _) => captured = u)
            .Returns(Task.CompletedTask);

        var entitlements = new Mock<IUserEntitlementService>();
        return (new BidSheetController(service.Object, entitlements.Object), () => captured);
    }

    private static async Task<BidSheetPreferenceUpdate> SendAsync(SetBidSheetPreferenceRequest request)
    {
        var (controller, captured) = CreateSut();
        await controller.SetPreference(request);
        Assert.NotNull(captured());
        return captured()!;
    }

    [Fact]
    public async Task Maps_every_field_to_its_own_property()
    {
        // Deliberately distinct values: a transposition between two same-typed slots is only visible
        // if no two fields carry the same content.
        var update = await SendAsync(new SetBidSheetPreferenceRequest
        {
            TradeUnitKey = GlobalKey,
            CropCode = "YC",
            Month = 9,
            CropYear = 2026,
            SelectedColumns = """[{"c":"YC","y":2026,"m":12}]""",
            CropOrder = """["YC","SB"]""",
            HiddenCrops = """["MILO"]""",
            SelectedMonths = "[4,5,6]",
            SelectedYears = "[2026,2027]",
            PrintLayout = """{"address":"1 Main St"}""",
            PriceMode = "both",
            SelectedBidSheetIds = "[120,133]"
        });

        Assert.Equal(GlobalKey, update.TradeUnitKey);
        Assert.Equal("YC", update.CropCode);
        Assert.Equal(9, update.Month);
        Assert.Equal(2026, update.CropYear);
        Assert.Equal("""[{"c":"YC","y":2026,"m":12}]""", update.SelectedColumns);
        Assert.Equal("""["YC","SB"]""", update.CropOrder);
        Assert.Equal("""["MILO"]""", update.HiddenCrops);
        Assert.Equal("[4,5,6]", update.SelectedMonths);
        Assert.Equal("[2026,2027]", update.SelectedYears);
        Assert.Equal("""{"address":"1 Main St"}""", update.PrintLayout);
        Assert.Equal("both", update.PriceMode);
        Assert.Equal("[120,133]", update.SelectedBidSheetIds);
    }

    /// <summary>
    /// The four JSON columns sit next to each other and all hold a bracketed string, so a slip between
    /// them is both the easiest to make and the hardest to see. Sending one at a time proves each
    /// lands alone, and that the other three stay null -- which is what the repository reads as
    /// "leave the stored value alone".
    /// </summary>
    [Theory]
    [InlineData(nameof(SetBidSheetPreferenceRequest.SelectedColumns))]
    [InlineData(nameof(SetBidSheetPreferenceRequest.CropOrder))]
    [InlineData(nameof(SetBidSheetPreferenceRequest.HiddenCrops))]
    [InlineData(nameof(SetBidSheetPreferenceRequest.SelectedMonths))]
    [InlineData(nameof(SetBidSheetPreferenceRequest.SelectedYears))]
    [InlineData(nameof(SetBidSheetPreferenceRequest.PrintLayout))]
    public async Task Sends_one_json_field_without_disturbing_its_neighbours(string field)
    {
        const string marker = "[\"only-this-one\"]";
        var request = new SetBidSheetPreferenceRequest
        {
            TradeUnitKey = GlobalKey,
            SelectedColumns = field == nameof(SetBidSheetPreferenceRequest.SelectedColumns) ? marker : null,
            CropOrder = field == nameof(SetBidSheetPreferenceRequest.CropOrder) ? marker : null,
            HiddenCrops = field == nameof(SetBidSheetPreferenceRequest.HiddenCrops) ? marker : null,
            SelectedMonths = field == nameof(SetBidSheetPreferenceRequest.SelectedMonths) ? marker : null,
            SelectedYears = field == nameof(SetBidSheetPreferenceRequest.SelectedYears) ? marker : null,
            PrintLayout = field == nameof(SetBidSheetPreferenceRequest.PrintLayout) ? marker : null
        };

        var update = await SendAsync(request);

        var carrying = new Dictionary<string, string?>
        {
            [nameof(update.SelectedColumns)] = update.SelectedColumns,
            [nameof(update.CropOrder)] = update.CropOrder,
            [nameof(update.HiddenCrops)] = update.HiddenCrops,
            [nameof(update.SelectedMonths)] = update.SelectedMonths,
            [nameof(update.SelectedYears)] = update.SelectedYears,
            [nameof(update.PrintLayout)] = update.PrintLayout
        };

        Assert.Equal(marker, carrying[field]);
        Assert.All(carrying.Where(kv => kv.Key != field), kv => Assert.Null(kv.Value));
    }

    /// <summary>
    /// The panel triple is the exception to "null leaves it alone": the server assigns it every time,
    /// because every caller re-sends the panel's current state, so a null here is a real "nothing
    /// selected" rather than "not specified". It must survive the mapping as null, not be dropped.
    /// </summary>
    [Fact]
    public async Task Carries_a_null_panel_selection_through_rather_than_omitting_it()
    {
        var update = await SendAsync(new SetBidSheetPreferenceRequest
        {
            TradeUnitKey = GlobalKey,
            CropCode = null,
            Month = null,
            CropYear = null,
            SelectedColumns = "[]"
        });

        Assert.Null(update.CropCode);
        Assert.Null(update.Month);
        Assert.Null(update.CropYear);
        // "[]" is how a caller CLEARS a JSON column; it must not be confused with null.
        Assert.Equal("[]", update.SelectedColumns);
    }
}
