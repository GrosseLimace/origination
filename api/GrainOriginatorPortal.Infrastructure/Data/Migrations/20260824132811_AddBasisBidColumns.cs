using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBasisBidColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BasisBid",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "BasisQuoteAsOf",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BasisSymbol",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BasisBid",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "BasisQuoteAsOf",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "BasisSymbol",
                schema: "dbo",
                table: "BidSheetLocationBids");
        }
    }
}
