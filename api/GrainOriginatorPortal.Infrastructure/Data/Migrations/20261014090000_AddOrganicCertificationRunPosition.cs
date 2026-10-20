using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the run position, total, customer code and skip reason to dbo.OrganicCertificationLoad.
    ///
    /// Together with FeedRunId (migration 20261007180000) these make run completeness answerable.
    /// The run id groups a night's messages but says nothing about how many there should have been;
    /// RunTotal supplies the denominator, carried on EVERY row rather than in a single end-of-run
    /// message that could itself go missing.
    ///
    /// 🔑 RunTotal counts every producer the sender CONSIDERED that night, not the ones it managed
    /// to send. That distinction is the whole design (Titus Vandezande, 2026-10-14): the sender only
    /// discovers mid-run that a producer has no USDA record — 23 of 839 in the Dev load — so a
    /// send-count cannot be known up front. Skipped producers arrive as their own rows with status
    /// "Skipped" rather than as gaps, so "we hold RunTotal distinct positions" still means the run
    /// finished, and a genuine failure still leaves a gap until it is re-sent.
    ///
    /// ScoularId is here because Nopid cannot always identify the producer: a skip with reason
    /// INELIGIBLE_NOP means the NOP id is blank or a placeholder in master data, so there is nothing
    /// to record. Without the customer code that row could not be tied back to a producer at all.
    ///
    /// SkipReason is what will finally explain the profile's "No certificate on file" warning, which
    /// today cannot tell "the feed has not reached us" from "USDA holds no record for them".
    ///
    /// Why a SEPARATE migration rather than editing 20261007180000: that one is already applied in
    /// Dev (an accidental deploy of 19d5d811 on 2026-10-07), so __EFMigrationsHistory there records
    /// it as done and it will never run again. Adding columns to it would leave Dev permanently
    /// without them.
    ///
    /// All four columns are nullable. Intraday one-off edits carry no run id, position or total, and
    /// that absence is precisely how they are told apart from a nightly run.
    /// </summary>
    public partial class AddOrganicCertificationRunPosition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RunPosition",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RunTotal",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScoularId",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SkipReason",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            // Widen the run index to cover the completeness query —
            // COUNT(DISTINCT RunPosition) WHERE FeedRunId = @run — rather than leaving it to a
            // lookup. Dropped and recreated because the key columns change.
            migrationBuilder.DropIndex(
                name: "IX_OrganicCertificationLoad_FeedRunId",
                schema: "dbo",
                table: "OrganicCertificationLoad");

            migrationBuilder.CreateIndex(
                name: "IX_OrganicCertificationLoad_FeedRunId",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                columns: ["FeedRunId", "RunPosition"],
                filter: "[FeedRunId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_OrganicCertificationLoad_FeedRunId",
                schema: "dbo",
                table: "OrganicCertificationLoad");

            migrationBuilder.DropColumn(
                name: "SkipReason",
                schema: "dbo",
                table: "OrganicCertificationLoad");

            migrationBuilder.DropColumn(
                name: "ScoularId",
                schema: "dbo",
                table: "OrganicCertificationLoad");

            migrationBuilder.DropColumn(
                name: "RunTotal",
                schema: "dbo",
                table: "OrganicCertificationLoad");

            migrationBuilder.DropColumn(
                name: "RunPosition",
                schema: "dbo",
                table: "OrganicCertificationLoad");

            migrationBuilder.CreateIndex(
                name: "IX_OrganicCertificationLoad_FeedRunId",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                column: "FeedRunId",
                filter: "[FeedRunId] IS NOT NULL");
        }
    }
}
