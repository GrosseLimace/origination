using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Records the SENDER's nightly run id alongside our own per-message batch id.
    ///
    /// The feed posts one message per producer with no batch boundary, so absence has been
    /// undetectable: we cannot tell "not sent tonight" from "unchanged". The integration team began
    /// stamping every message in a run with a shared id on 2026-10-07 (e.g.
    /// "replay-20261007T162718Z-d3dbb1f3"), which is the missing boundary.
    ///
    /// Two columns because they answer two different questions:
    ///   OrganicCertificationLoad.FeedRunId   — how many messages did run X carry, how many failed
    ///   OrganicCertification.LastFeedRunId   — which producers did run X NOT touch
    ///
    /// Why now, when nothing reads either one: the run ids are the only part that cannot be
    /// recreated later. The code can be written any time; once nightly runs have passed without
    /// being recorded, those boundaries are gone for good.
    ///
    /// ⚠️ This does NOT make it safe to deactivate on absence, and that is the easy mistake to make
    /// next. Knowing which producers a run touched says nothing about whether the run FINISHED — a
    /// pipeline that sends 400 of 1,000 and dies would make 600 healthy producers look absent.
    /// That needs an end-of-run signal we do not have. Approved as recording-only (Caden Egr,
    /// 2026-10-07).
    ///
    /// Adding a nullable column is metadata-only in SQL Server: instant, no table rewrite, no
    /// downtime. Existing rows get NULL, which correctly reads as "arrived before we tracked this".
    /// </summary>
    public partial class AddOrganicCertificationFeedRunId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FeedRunId",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastFeedRunId",
                schema: "dbo",
                table: "OrganicCertification",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            // Filtered: every row written before today carries NULL here and none of them can ever
            // be the subject of "show me run X", so they stay out of the index entirely.
            migrationBuilder.CreateIndex(
                name: "IX_OrganicCertificationLoad_FeedRunId",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                column: "FeedRunId",
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
                name: "LastFeedRunId",
                schema: "dbo",
                table: "OrganicCertification");

            migrationBuilder.DropColumn(
                name: "FeedRunId",
                schema: "dbo",
                table: "OrganicCertificationLoad");
        }
    }
}
