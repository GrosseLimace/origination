using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Widens the three free-text columns on dbo.OrganicCertificationItem to fit the real USDA data.
    ///
    /// The original widths (100 / 1,000 / 2,000) were sized from the two sample messages we held on
    /// 2026-09-29. On 2026-10-07 the integration team measured the whole USDA set instead and found
    /// the samples were not representative:
    ///
    ///     certificateNumber   max   194    (2 items over 100)
    ///     varieties           max 3,998  (385 items over 1,000)
    ///     otherItems          max 3,996  (272 items over 2,000)
    ///
    /// ~4,000 looks like USDA's own ceiling, so 4,000 is the natural stop rather than a guess, and
    /// it is also the largest nvarchar that is not MAX — keeping these in-row and indexable.
    ///
    /// Why this is worth a migration rather than truncation at ingest: validation runs over the
    /// whole message before anything is written, so a SINGLE over-length item rejects that
    /// producer's entire certification — every scope and every crop — not just the offending row.
    /// At the measured counts that is several hundred producers silently absent from the feed.
    ///
    /// Widening an nvarchar is a metadata-only change in SQL Server; no row is rewritten and no
    /// data can be lost, which is why there is no backfill and why Down() is the risky direction.
    /// </summary>
    public partial class WidenOrganicCertificationItemText : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "CertificateNumber",
                schema: "dbo",
                table: "OrganicCertificationItem",
                type: "nvarchar(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Varieties",
                schema: "dbo",
                table: "OrganicCertificationItem",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(1000)",
                oldMaxLength: 1000,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "OtherItems",
                schema: "dbo",
                table: "OrganicCertificationItem",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(2000)",
                oldMaxLength: 2000,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // NARROWING IS LOSSY. Once real feed data has landed, any value longer than the old
            // width makes these statements fail outright (SQL Server will not silently truncate on
            // ALTER COLUMN) — which is the safe failure, but it means Down() is not a clean
            // reversal on a database that has ingested. Truncate or clear the column first if you
            // genuinely need to roll back.
            migrationBuilder.AlterColumn<string>(
                name: "OtherItems",
                schema: "dbo",
                table: "OrganicCertificationItem",
                type: "nvarchar(2000)",
                maxLength: 2000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(4000)",
                oldMaxLength: 4000,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Varieties",
                schema: "dbo",
                table: "OrganicCertificationItem",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(4000)",
                oldMaxLength: 4000,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "CertificateNumber",
                schema: "dbo",
                table: "OrganicCertificationItem",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(255)",
                oldMaxLength: 255,
                oldNullable: true);
        }
    }
}
