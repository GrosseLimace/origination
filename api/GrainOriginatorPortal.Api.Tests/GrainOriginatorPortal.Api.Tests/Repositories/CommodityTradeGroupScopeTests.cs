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

        // 12 conventional + 4 organic. Scoping is the client's job, not the repository's.
        Assert.Equal(16, result.Count);
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
        var conventional = result.Where(c => !OrganicCodes.Contains(c.Code)).ToList();
        Assert.Equal(12, conventional.Count);
        Assert.All(conventional, c => Assert.Null(c.TradeGroupScope));
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
}
