using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// Trims leading/trailing spaces from dbo.Customer.ScoularId so lookups can compare the indexed
    /// column directly instead of through Trim(), which stopped SQL Server seeking IX_Customer_ScoularId
    /// (audit 2026-11-05, sql.scoularid-trim-defeats-index-seek). The deploy applies migrations before
    /// the new code starts, so the data is clean before anything stops trimming it.
    /// </summary>
    /// <remarks>
    /// DATALENGTH, not &lt;&gt;: SQL Server's '=' and '&lt;&gt;' ignore trailing spaces, so 'ABC ' &lt;&gt; 'ABC'
    /// is false and would miss exactly the rows this is for. The index is not unique, so two rows that
    /// trim to the same code cannot make this fail. Down is a no-op: the original padding is not worth
    /// keeping and cannot be recovered.
    /// </remarks>
    public partial class TrimCustomerScoularIds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE dbo.Customer
                SET ScoularId = LTRIM(RTRIM(ScoularId))
                WHERE ScoularId IS NOT NULL
                  AND DATALENGTH(ScoularId) <> DATALENGTH(LTRIM(RTRIM(ScoularId)));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
