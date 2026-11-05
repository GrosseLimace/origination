// Microsoft namespaces
using Microsoft.EntityFrameworkCore.Migrations.Operations;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data.Migrations;

namespace GrainOriginatorPortal.Api.Tests.Migrations;

/// <summary>
/// Customer lookups compare dbo.Customer.ScoularId as stored, so IX_Customer_ScoularId can be used
/// (audit 2026-11-05). That is only safe once no stored code carries a space; this migration cleans
/// the existing rows. Pin the SQL it deploys.
/// </summary>
public class TrimCustomerScoularIdsTests
{
    [Fact]
    public void Up_TrimsBothEndsOfEveryPaddedCode()
    {
        var sql = SingleSql(new TrimCustomerScoularIds().UpOperations);

        Assert.Contains("UPDATE dbo.Customer", sql);
        Assert.Contains("SET ScoularId = LTRIM(RTRIM(ScoularId))", sql);
    }

    // SQL Server's '<>' ignores trailing spaces ('ABC ' <> 'ABC' is false), so a "simpler" WHERE would
    // silently skip exactly the rows this migration exists for. Byte lengths see the difference.
    [Fact]
    public void Up_FindsPaddedRowsByByteLength_NotByComparison()
    {
        var sql = SingleSql(new TrimCustomerScoularIds().UpOperations);

        Assert.Contains("DATALENGTH(ScoularId) <> DATALENGTH(LTRIM(RTRIM(ScoularId)))", sql);
        Assert.DoesNotContain("ScoularId <> LTRIM", sql);
    }

    [Fact]
    public void Down_DoesNothing_ThePaddingIsNotRecoverable()
    {
        Assert.Empty(new TrimCustomerScoularIds().DownOperations);
    }

    private static string SingleSql(IReadOnlyList<MigrationOperation> operations) =>
        Assert.IsType<SqlOperation>(Assert.Single(operations)).Sql;
}
