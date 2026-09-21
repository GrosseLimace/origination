// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers the trade-group scoping added for the Organics &amp; IP crops (HRWO/WHTO/YCO/YSBO).
///
/// The split matters: the repository deliberately does NOT filter by scope. It serves the full
/// curated superset so /api/commodities/planting stays globally cacheable, and the client hides
/// out-of-scope rows via scopeCommodities(). These tests pin that contract down — if someone later
/// "fixes" the repository to filter, the client would silently double-filter against a scope the
/// server can't actually know (it never sees the user's current selection).
/// </summary>
public class CommodityTradeGroupScopeTests
{
    /// <summary>The four organic codes, exactly as the AddCommodityTradeGroupScope migration seeds them.</summary>
    private static readonly string[] OrganicCodes = ["HRWO", "WHTO", "YCO", "YSBO"];

    /// <summary>The four grades restricted to units 2090/2291/2295 by AddCommodityTradeUnitScope.</summary>
    private static readonly string[] UnitScopedCodes = ["DNGS", "DOSB", "HEC", "YWC"];

    /// <summary>The four flax grades restricted to unit 3811 by AddFlaxCommoditiesForTradeUnit3811.</summary>
    private static readonly string[] FlaxCodes = ["BFL1", "BFL2", "GFL1", "GFL2"];

    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"commodityscope-{Guid.NewGuid()}")
            .Options);

        var id = 1;
        // The curated conventional set, as seeded by the four ShowInPlantingIntentions migrations.
        foreach (var code in new[] { "HRWW", "SRWW", "HWW", "YC", "YCNG", "YSB", "NYSB", "SOR", "SWW", "DNSW", "CANP", "MIL" })
            db.Commodities.Add(new Commodity { Id = id++, Code = code, Name = code, IsActive = true, ShowInPlantingIntentions = true });

        // The organics: curated AND scoped.
        db.Commodities.Add(new Commodity { Id = id++, Code = "HRWO", Name = "ORGANIC HARD RED WINTER WHEAT", Category = "WHEAT", IsActive = true, ShowInPlantingIntentions = true, TradeGroupScope = "Organics" });
        db.Commodities.Add(new Commodity { Id = id++, Code = "WHTO", Name = "ORGANIC WHEAT", Category = "WHEAT", IsActive = true, ShowInPlantingIntentions = true, TradeGroupScope = "Organics" });
        db.Commodities.Add(new Commodity { Id = id++, Code = "YCO", Name = "ORGANIC YELLOW CORN", Category = "CORN", IsActive = true, ShowInPlantingIntentions = true, TradeGroupScope = "Organics" });
        db.Commodities.Add(new Commodity { Id = id++, Code = "YSBO", Name = "ORGANIC SOYBEANS", Category = "SOYBEANS", IsActive = true, ShowInPlantingIntentions = true, TradeGroupScope = "Organics" });

        // Unit-scoped: curated, but restricted to three of the six Organics & IP units.
        foreach (var (code, name, cat) in new[] {
            ("DNGS", "DEHULLED NON-GMO SOYBEANS", "SOYBEANS"),
            ("DOSB", "DEHULLED ORGANIC SOYBEANS", "SOYBEANS"),
            ("HEC",  "HARD ENDOSPERM CORN",       "CORN"),
            ("YWC",  "WAXY CORN",                 "CORN") })
            db.Commodities.Add(new Commodity { Id = id++, Code = code, Name = name, Category = cat, IsActive = true, ShowInPlantingIntentions = true, TradeUnitScope = "2090,2291,2295" });

        // Unit-scoped to a single unit (3811, Pulses Trading). Category is the ODS commodity GROUP, which
        // is why these carry a PlantingCategory: "FEED & FERT INGREDIENTS" is no crop label.
        foreach (var (code, name) in new[] {
            ("BFL1", "BROWN FLAX #1"),
            ("BFL2", "BROWN FLAX #2"),
            ("GFL1", "GOLDEN FLAX #1"),
            ("GFL2", "GOLDEN FLAX #2") })
            db.Commodities.Add(new Commodity { Id = id++, Code = code, Name = name, Category = "FEED & FERT INGREDIENTS", IsActive = true, ShowInPlantingIntentions = true, TradeUnitScope = "3811", PlantingCategory = "Flax" });

        // Uncurated noise that must stay out of the planting list regardless of scope.
        db.Commodities.Add(new Commodity { Id = id++, Code = "SORO", Name = "ORGANIC SORGHUM", Category = "SORGHUM", IsActive = true, ShowInPlantingIntentions = false });
        db.Commodities.Add(new Commodity { Id = id++, Code = "RETIRED", Name = "RETIRED", IsActive = false, ShowInPlantingIntentions = true, TradeGroupScope = "Organics" });

        db.SaveChanges();
        return db;
    }

    private static CommodityRepository Repo(ApplicationDbContext db) =>
        new(new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"ods-{Guid.NewGuid()}").Options), db);

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetPlantingAsync_serves_the_superset_including_scoped_rows()
    {
        using var db = NewContext();

        var result = await Repo(db).GetPlantingAsync(CancellationToken.None);

        // 12 conventional + 4 organic + 4 unit-scoped + 4 flax. Scoping is the client's job, not the repository's.
        Assert.Equal(24, result.Count);
        foreach (var code in OrganicCodes)
            Assert.Contains(result, c => c.Code == code);
    }

    [Fact]
    public async Task GetPlantingAsync_still_honours_the_curated_flag_and_IsActive()
    {
        using var db = NewContext();

        var result = await Repo(db).GetPlantingAsync(CancellationToken.None);

        // SORO is organic but uncurated; RETIRED is curated and scoped but inactive.
        Assert.DoesNotContain(result, c => c.Code == "SORO");
        Assert.DoesNotContain(result, c => c.Code == "RETIRED");
    }

    [Fact]
    public async Task Conventional_curated_rows_carry_no_scope_so_everyone_keeps_seeing_them()
    {
        using var db = NewContext();

        var result = await Repo(db).GetPlantingAsync(CancellationToken.None);

        // The regression that matters: this change must be invisible to conventional originators.
        var conventional = result.Where(c => !OrganicCodes.Contains(c.Code) && !UnitScopedCodes.Contains(c.Code) && !FlaxCodes.Contains(c.Code)).ToList();
        Assert.Equal(12, conventional.Count);
        Assert.All(conventional, c => Assert.Null(c.TradeGroupScope));
        Assert.All(conventional, c => Assert.Null(c.TradeUnitScope));
    }

    [Fact]
    public async Task GetActiveAsync_leaves_scoped_rows_in_the_full_catalog()
    {
        using var db = NewContext();

        var result = await Repo(db).GetActiveAsync(CancellationToken.None);

        // The full list resolves code -> name for display. Scoping it would strip the label off an
        // existing organic bid whenever a conventional user looked at it.
        Assert.Contains(result, c => c.Code == "YCO");
        Assert.Contains(result, c => c.Code == "SORO");
    }

    [Fact]
    public void ToResponse_carries_TradeGroupScope_to_the_client()
    {
        // Without this the client has nothing to filter on and every user sees the organics.
        var scoped = new Commodity { Code = "YCO", Name = "ORGANIC YELLOW CORN", Category = "CORN", TradeGroupScope = "Organics" }.ToResponse();
        var unscoped = new Commodity { Code = "YC", Name = "YELLOW CORN", Category = "CORN" }.ToResponse();

        Assert.Equal("Organics", scoped.TradeGroupScope);
        Assert.Null(unscoped.TradeGroupScope);
    }

    [Fact]
    public void ToResponse_carries_PlantingCategory_and_leaves_Category_as_the_base_crop()
    {
        // The planting dashboard groups YSBO under "Organic Soybeans" via this field. Category itself
        // must stay the base crop: it is the app-wide crop-group key (Build-A-List chips, NLQ, colours),
        // so the organic label is an override, not a rename.
        var organic = new Commodity { Code = "YSBO", Name = "ORGANIC SOYBEANS", Category = "Soybeans", PlantingCategory = "Organic Soybeans" }.ToResponse();
        var conventional = new Commodity { Code = "YSB", Name = "YELLOW SOYBEANS", Category = "Soybeans" }.ToResponse();

        Assert.Equal("Organic Soybeans", organic.PlantingCategory);
        Assert.Equal("Soybeans", organic.Category);
        Assert.Null(conventional.PlantingCategory);
    }

    [Theory]
    [InlineData("YCO", "Corn")]
    [InlineData("YSBO", "Soybeans")]
    [InlineData("HRWO", "Wheat")]
    [InlineData("WHTO", "Wheat")]
    public void Organic_rows_carry_their_base_crop_category_so_colours_resolve_for_free(string code, string crop)
    {
        using var db = NewContext();

        // commodity-color.ts keys off category, not code — that is the whole reason YCO renders
        // corn-amber and HRWO wheat-green without touching the palette. Compared case-insensitively
        // on purpose: PopulateCommodities.sql writes 'WHEAT' but Dev actually holds 'Wheat', and the
        // palette lower-cases its key, so both resolve. What would actually break the colours is the
        // category becoming something the palette has no entry for — that is what this pins down.
        var category = db.Commodities.Single(c => c.Code == code).Category;

        Assert.Equal(crop, category, ignoreCase: true);
    }

    [Fact]
    public async Task GetPlantingAsync_serves_unit_scoped_rows_too_without_filtering()
    {
        using var db = NewContext();

        var result = await Repo(db).GetPlantingAsync(CancellationToken.None);

        // Same contract as the group scope: the repository never filters. It cannot -- the server
        // only knows the caller's entitlements, never what they currently have selected.
        foreach (var code in UnitScopedCodes)
            Assert.Contains(result, c => c.Code == code);
    }

    [Fact]
    public async Task Unit_scoped_rows_carry_the_three_target_units_and_no_group_scope()
    {
        using var db = NewContext();

        var rows = (await Repo(db).GetPlantingAsync(CancellationToken.None))
            .Where(c => UnitScopedCodes.Contains(c.Code)).ToList();

        Assert.Equal(4, rows.Count);
        // Group scope stays null: these are additive to what the Organics group already grants,
        // and the two columns OR together rather than intersecting.
        Assert.All(rows, c => Assert.Null(c.TradeGroupScope));
        Assert.All(rows, c => Assert.Equal("2090,2291,2295", c.TradeUnitScope));
    }

    [Fact]
    public async Task Flax_rows_are_served_unfiltered_scoped_to_3811_alone_and_labelled_Flax()
    {
        using var db = NewContext();

        var rows = (await Repo(db).GetPlantingAsync(CancellationToken.None))
            .Where(c => FlaxCodes.Contains(c.Code)).ToList();

        // Same contract as the other unit-scoped grades: served to everyone, hidden client-side.
        Assert.Equal(4, rows.Count);
        // A single-unit scope is just a one-element list; no group scope, because 3811 is in no
        // Organics group and the two scopes OR together.
        Assert.All(rows, c => Assert.Equal("3811", c.TradeUnitScope));
        Assert.All(rows, c => Assert.Null(c.TradeGroupScope));
        // Category stays the ODS group (the app-wide crop key) and the planting label carries the
        // crop instead -- otherwise the dashboard would group flax acres under "FEED & FERT INGREDIENTS".
        Assert.All(rows, c => Assert.Equal("FEED & FERT INGREDIENTS", c.Category));
        Assert.All(rows, c => Assert.Equal("Flax", c.PlantingCategory));
    }

    [Fact]
    public void ToResponse_carries_TradeUnitScope_to_the_client()
    {
        // Without this the client has nothing to match units on and the rows reach everyone.
        var scoped = new Commodity { Code = "DNGS", Name = "DEHULLED NON-GMO SOYBEANS", TradeUnitScope = "2090,2291,2295" }.ToResponse();
        var unscoped = new Commodity { Code = "YC", Name = "YELLOW CORN" }.ToResponse();

        Assert.Equal("2090,2291,2295", scoped.TradeUnitScope);
        Assert.Null(unscoped.TradeUnitScope);
    }
}
