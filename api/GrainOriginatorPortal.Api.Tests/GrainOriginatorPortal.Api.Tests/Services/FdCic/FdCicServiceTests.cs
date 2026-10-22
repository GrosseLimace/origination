// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services.FdCic;

namespace GrainOriginatorPortal.Api.Tests.Services.FdCic;

/// <summary>
/// The FD-CIC service: which version scores a year, input validation against that version's labels,
/// unscorable places, and refusing to score with a version that failed its test cases.
/// </summary>
public class FdCicServiceTests
{
    private static readonly Lazy<FdCicPack> V12 = new(() => FdCicPack.LoadEmbedded("1.2"));

    private static FdCicService Service(Dictionary<int, string>? byYear = null, Func<string, FdCicPack>? loadPack = null) =>
        new(new FdCicSettings(byYear ?? new Dictionary<int, string> { [2026] = "1.2" }),
            [new FdCicMethodV1()],
            NullLogger<FdCicService>.Instance,
            loadPack ?? (v => v == "1.2" ? V12.Value : FdCicPack.LoadEmbedded(v)));

    private static FdCicInput StoryCorn(double? actualYield = 200, string cover = "No cover crop", string county = "Story", string state = "IA") =>
        new("Corn", state, county, actualYield, 190, 180, 0.5, cover, "No till", []);

    [Fact]
    public void Score_UsesTheYearsVersion_AndStampsIt()
    {
        var score = Service().Score(2026, StoryCorn());

        Assert.True(score.Scorable);
        Assert.Equal("1.2", score.Version);
        Assert.Equal("USDA FD-CIC v1.2", score.Label);
        Assert.Equal(V12.Value.Manifest.Source.Sha256, score.SourceSha256);
        Assert.Equal(FdCicMethodV1.Fingerprint, score.FormulaFingerprint);
        Assert.Equal(3070.75, score.Ci!.Value, 2);
        Assert.False(score.Projected);
        Assert.Equal("g CO2e/bu", score.Unit);
    }

    [Fact]
    public void Score_WithoutActualYield_IsProjectedFromExpectedYield()
    {
        var score = Service().Score(2026, StoryCorn(actualYield: null));

        Assert.True(score.Projected);
        Assert.Equal(190, score.YieldForCi);
        Assert.True(score.Scorable);
    }

    [Fact]
    public void Score_AYearWithNoVersion_IsABusinessError()
    {
        var ex = Assert.Throws<BusinessException>(() => Service().Score(2030, StoryCorn()));

        Assert.Equal("FD_CIC_NO_VERSION_FOR_YEAR", ex.ErrorCode);
    }

    [Fact]
    public void Score_RejectsLabelsTheVersionDoesNotUse()
    {
        var ex = Assert.Throws<ValidationException>(() => Service().Score(2026, StoryCorn(cover: "Rye")));

        Assert.True(ex.Errors.ContainsKey("coverCrop"));
    }

    [Fact]
    public void Score_RejectsAnUnknownCounty()
    {
        var ex = Assert.Throws<ValidationException>(() => Service().Score(2026, StoryCorn(county: "Nowhere")));

        Assert.True(ex.Errors.ContainsKey("county"));
    }

    [Fact]
    public void Score_RejectsZeroExpectedYield_AndTooManyManures()
    {
        var input = StoryCorn() with
        {
            ExpectedYield = 0,
            Manure = [new(1, 1), new(1, 1), new(1, 1), new(1, 1)],
        };

        var ex = Assert.Throws<ValidationException>(() => Service().Score(2026, input));

        Assert.True(ex.Errors.ContainsKey("expectedYield"));
        Assert.True(ex.Errors.ContainsKey("manure"));
    }

    [Fact]
    public void Score_APlaceUsdaHasNoDataFor_IsUnscorableWithAReason()
    {
        // Andrews County, TX is MLRA 77D, which has no corn N2O emission factors in v1.2 (Excel: #N/A).
        var score = Service().Score(2026, StoryCorn(county: "Andrews", state: "TX"));

        Assert.False(score.Scorable);
        Assert.Null(score.Ci);
        Assert.Null(score.Components);
        Assert.Contains("77D", score.UnscorableReason);
    }

    [Fact]
    public void AVersionThatFailsItsTestCases_ScoresNothing_AndSaysWhy()
    {
        var broken = V12.Value with
        {
            Golden = V12.Value.Golden with { ConfirmedInExcel = V12.Value.Golden.ConfirmedInExcel! with { WorkbookSha256 = new string('b', 64) } },
        };
        var service = Service(loadPack: _ => broken);

        var ex = Assert.Throws<InfrastructureException>(() => service.Score(2026, StoryCorn()));
        Assert.Equal("FD_CIC_VERSION_UNAVAILABLE", ex.ErrorCode);

        var status = Assert.Single(service.Versions());
        Assert.False(status.Available);
        Assert.Contains("different workbook", status.Problem);
    }

    [Fact]
    public void AConfiguredVersionWithNoPack_IsReportedUnavailable()
    {
        var service = Service(new Dictionary<int, string> { [2026] = "1.2", [2027] = "9.9" });

        var versions = service.Versions();

        Assert.True(versions.Single(v => v.Version == "1.2").Available);
        var missing = versions.Single(v => v.Version == "9.9");
        Assert.False(missing.Available);
        Assert.Equal(new[] { 2027 }, missing.Years);
        Assert.Throws<InfrastructureException>(() => service.Score(2027, StoryCorn()));
    }

    [Fact]
    public void Options_AndCounties_ComeFromTheYearsVersion()
    {
        var service = Service();

        var options = service.Options(2026);
        Assert.Equal("1.2", options.Version);
        Assert.Contains("Corn", options.Crops);
        Assert.Contains("No till", options.Tillage);
        Assert.Contains("IA", options.States);
        Assert.Equal(8, options.ManureTypes.Count);

        Assert.Contains("Story", service.Counties(2026, "ia"));
    }

    [Fact]
    public void Settings_ReadTheYearMap()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["FdCic:VersionByYear:2026"] = "1.2" })
            .Build();

        Assert.Equal("1.2", FdCicSettings.From(config).VersionByYear[2026]);
    }

    [Fact]
    public void Settings_RefuseAnEntryThatIsNotAYear()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["FdCic:VersionByYear:twenty26"] = "1.2" })
            .Build();

        Assert.Throws<InvalidOperationException>(() => FdCicSettings.From(config));
    }

    [Fact]
    public void TheShippedConfiguration_ScoresTheCurrentYear()
    {
        var config = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"), optional: false)
            .Build();

        var settings = FdCicSettings.From(config);

        Assert.Equal("1.2", settings.VersionByYear[2026]);
    }
}
