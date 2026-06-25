using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Creates <c>dbo.GetRecapNotes</c> — the parameterized note lookup the Notes Daily Recap Logic App
    /// calls (one row per note created in the last 24h by the given user). Replaces the workflow's
    /// previous inline SQL that string-concatenated the (untrusted) member value into the
    /// <c>CreatedBy</c> predicate; the value is now bound as the <c>@CreatedBy</c> parameter, so a crafted
    /// member value can no longer alter the query (SQL injection).
    /// </summary>
    public partial class AddGetRecapNotesProc : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // CREATE OR ALTER must be the first statement in its batch — keep this as a single Sql() call.
            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE dbo.GetRecapNotes
    @CreatedBy NVARCHAR(256)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        n.CustomerId,
        n.TradeUnit,
        n.Description,
        n.CreatedBy,
        n.CreatedAt,
        c.CustomerName,
        c.ScoularId
    FROM dbo.Notes n
    JOIN dbo.Customer c
        ON n.CustomerId = c.CustomerId
    WHERE n.CreatedAt >= DATEADD(HOUR, -24, GETDATE())
      AND n.CreatedBy = @CreatedBy;
END");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS dbo.GetRecapNotes;");
        }
    }
}
