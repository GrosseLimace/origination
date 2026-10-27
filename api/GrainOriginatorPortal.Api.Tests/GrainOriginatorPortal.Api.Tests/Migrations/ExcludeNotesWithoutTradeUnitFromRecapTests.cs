// Microsoft namespaces
using Microsoft.EntityFrameworkCore.Migrations.Operations;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data.Migrations;

namespace GrainOriginatorPortal.Api.Tests.Migrations;

/// <summary>
/// The Notes Daily Recap leaves out notes with no trade unit (PROD 2026-10-21: one such note failed
/// the run). The filter lives in dbo.GetRecapNotes, so pin the proc text the migration deploys.
/// </summary>
public class ExcludeNotesWithoutTradeUnitFromRecapTests
{
    private const string TradeUnitFilter = "AND n.TradeUnit IS NOT NULL";

    [Fact]
    public void Up_FiltersOutNotesWithoutATradeUnit()
    {
        var sql = SingleSql(new ExcludeNotesWithoutTradeUnitFromRecap().UpOperations);

        Assert.Contains("CREATE OR ALTER PROCEDURE dbo.GetRecapNotes", sql);
        Assert.Contains(TradeUnitFilter, sql);
    }

    [Fact]
    public void Up_KeepsTheExistingFilters()
    {
        var sql = SingleSql(new ExcludeNotesWithoutTradeUnitFromRecap().UpOperations);

        Assert.Contains("n.CreatedAt >= DATEADD(HOUR, -24, GETDATE())", sql);
        Assert.Contains("n.CreatedBy = @CreatedBy", sql);
    }

    [Fact]
    public void Down_RestoresTheProcWithoutTheFilter()
    {
        var sql = SingleSql(new ExcludeNotesWithoutTradeUnitFromRecap().DownOperations);

        Assert.Contains("CREATE OR ALTER PROCEDURE dbo.GetRecapNotes", sql);
        Assert.DoesNotContain(TradeUnitFilter, sql);
    }

    // CREATE OR ALTER must be the first statement in its batch, so each direction is one Sql() call.
    private static string SingleSql(IReadOnlyList<MigrationOperation> operations) =>
        Assert.IsType<SqlOperation>(Assert.Single(operations)).Sql;
}
