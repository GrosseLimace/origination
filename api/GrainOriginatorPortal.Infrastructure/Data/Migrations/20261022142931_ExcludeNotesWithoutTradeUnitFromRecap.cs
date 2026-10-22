using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Leaves notes with no trade unit out of the Notes Daily Recap. A note's TradeUnit is stamped
    /// from the producer's first ACTIVE trade unit, so it is NULL when the producer had none at the
    /// time -- e.g. their last trade unit was removed as dormant. PROD 2026-10-21: one such note made
    /// the Logic App's Parse_JSON fail and dropped the recap for every group containing its author.
    /// <para>
    /// Filtered here rather than in the Logic App because the workflow counts the proc's rows to
    /// decide whether a group gets a recap at all; filtering after that would send empty recaps.
    /// CREATE OR ALTER keeps the existing EXECUTE grant to the Logic App identity.
    /// </para>
    /// </summary>
    public partial class ExcludeNotesWithoutTradeUnitFromRecap : Migration
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
      AND n.CreatedBy = @CreatedBy
      AND n.TradeUnit IS NOT NULL;
END");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Restores the AddGetRecapNotesProc definition.
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
    }
}
