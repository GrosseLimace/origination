using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class DropCustomerSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // CustomerSnapshot is fully superseded by dbo.Customer + dbo.CustomerTradeUnit
            // (Phase 2a). All reads switched to the new tables; the only remaining writer
            // was the dev-only populate endpoint, which has been simplified in Phase 2b
            // to no longer touch this table.
            //
            // IF EXISTS guard for idempotency / safety in environments where the table
            // may already have been dropped manually.
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[CustomerSnapshot]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CustomerSnapshot",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    CustomerName = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    EffectiveEndDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    EffectiveStartDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ExtendedAddressLine1 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedAddressLine2 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedAddressLine3 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedAddressLine4 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedCity = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedCountry = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedPostalCode = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedPrimaryPhone = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedStateProvince = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    IndustryCode1 = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    MerchandisingAddressLine1 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingCity = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingEmail = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingPhone = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingPostalCode = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingStateProvince = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ScoularId = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    SnapshotRefreshedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    SupplementalEmail = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    TradeUnit = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerSnapshot", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerSnapshot_CustomerId",
                schema: "dbo",
                table: "CustomerSnapshot",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerSnapshot_IsActive_TradeUnit_CustomerName",
                schema: "dbo",
                table: "CustomerSnapshot",
                columns: new[] { "IsActive", "TradeUnit", "CustomerName" });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerSnapshot_ScoularId",
                schema: "dbo",
                table: "CustomerSnapshot",
                column: "ScoularId");
        }
    }
}
