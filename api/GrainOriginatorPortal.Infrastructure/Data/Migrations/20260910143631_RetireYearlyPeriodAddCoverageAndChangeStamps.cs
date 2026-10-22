using System;

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class RetireYearlyPeriodAddCoverageAndChangeStamps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "BasisChangedAt",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CashChangedAt",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CoveredByCropYear",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CoveredByMonth",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "int",
                nullable: true);

            // The Yearly period (Month 0) is retired. The feed's own Year rows go now rather than on the
            // next nightly run, so the first screen after deploy is already consistent. Hand-typed Month 0
            // rows are deliberately LEFT: QA holds 98 of them from six originators, and whether they are
            // converted to a delivery month or dropped is the business's call, not a migration's. They are
            // simply never shown -- the sheet no longer requests Month 0 and the API refuses to write it.
            migrationBuilder.Sql("DELETE FROM dbo.BidSheetLocationBids WHERE Source = N'Barchart' AND [Month] = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BasisChangedAt",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "CashChangedAt",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "CoveredByCropYear",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "CoveredByMonth",
                schema: "dbo",
                table: "BidSheetLocationBids");
        }
    }
}
