using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class CreateCustomerAndCustomerTradeUnit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Customer",
                schema: "dbo",
                columns: table => new
                {
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    ScoularId = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    CustomerName = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    MerchandisingCity = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    MerchandisingStateProvince = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    MerchandisingAddressLine1 = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    MerchandisingPostalCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    MerchandisingPhone = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    MerchandisingEmail = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ExtendedPrimaryPhone = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    SupplementalEmail = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ExtendedAddressLine1 = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ExtendedAddressLine2 = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ExtendedAddressLine3 = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ExtendedAddressLine4 = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ExtendedCity = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ExtendedPostalCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    ExtendedStateProvince = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    ExtendedCountry = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    IndustryCode1 = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    EffectiveStartDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    EffectiveEndDate = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Customer", x => x.CustomerId);
                });

            migrationBuilder.CreateTable(
                name: "CustomerTradeUnit",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    TradeUnit = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerTradeUnit", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CustomerTradeUnit_Customer_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Customer_CustomerName",
                schema: "dbo",
                table: "Customer",
                column: "CustomerName");

            migrationBuilder.CreateIndex(
                name: "IX_Customer_ScoularId",
                schema: "dbo",
                table: "Customer",
                column: "ScoularId");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerTradeUnit_TradeUnit_IsActive",
                schema: "dbo",
                table: "CustomerTradeUnit",
                columns: new[] { "TradeUnit", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "UQ_CustomerTradeUnit_CustomerId_TradeUnit",
                schema: "dbo",
                table: "CustomerTradeUnit",
                columns: new[] { "CustomerId", "TradeUnit" },
                unique: true);

            // -----------------------------------------------------------------
            // Backfill from dbo.CustomerSnapshot — the previous denormalized
            // materialization. One row per CustomerId for dbo.Customer (taking
            // attribute columns from the first snapshot row by CustomerName;
            // attributes are consistent across rows since they all come from
            // the same source ODS customer record). One row per
            // (CustomerId, TradeUnit) for dbo.CustomerTradeUnit, filtering out
            // any rows with a NULL TradeUnit.
            //
            // NOT EXISTS guards keep this idempotent — safe to re-run, safe in
            // environments where these tables may have been pre-populated.
            //
            // Backfill is a no-op in environments where CustomerSnapshot is
            // empty (e.g. a fresh DB) — those will get populated by the
            // dev-only POST /api/diagnostics/customer-snapshot/populate
            // endpoint or by the Phase 6 sync job once it ships.
            // -----------------------------------------------------------------
            migrationBuilder.Sql(@"
                INSERT INTO [dbo].[Customer] (
                    CustomerId, ScoularId, CustomerName,
                    MerchandisingCity, MerchandisingStateProvince, MerchandisingAddressLine1, MerchandisingPostalCode,
                    MerchandisingPhone, MerchandisingEmail, ExtendedPrimaryPhone, SupplementalEmail,
                    ExtendedAddressLine1, ExtendedAddressLine2, ExtendedAddressLine3, ExtendedAddressLine4,
                    ExtendedCity, ExtendedPostalCode, ExtendedStateProvince, ExtendedCountry,
                    IndustryCode1, IsActive, EffectiveStartDate, EffectiveEndDate
                )
                SELECT
                    s.CustomerId, s.ScoularId, s.CustomerName,
                    s.MerchandisingCity, s.MerchandisingStateProvince, s.MerchandisingAddressLine1, s.MerchandisingPostalCode,
                    s.MerchandisingPhone, s.MerchandisingEmail, s.ExtendedPrimaryPhone, s.SupplementalEmail,
                    s.ExtendedAddressLine1, s.ExtendedAddressLine2, s.ExtendedAddressLine3, s.ExtendedAddressLine4,
                    s.ExtendedCity, s.ExtendedPostalCode, s.ExtendedStateProvince, s.ExtendedCountry,
                    s.IndustryCode1, s.IsActive, s.EffectiveStartDate, s.EffectiveEndDate
                FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY CustomerId ORDER BY CustomerName) AS rn
                    FROM [dbo].[CustomerSnapshot]
                ) s
                WHERE s.rn = 1
                  AND NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.CustomerId = s.CustomerId);
            ");

            migrationBuilder.Sql(@"
                INSERT INTO [dbo].[CustomerTradeUnit] (CustomerId, TradeUnit, IsActive)
                SELECT s.CustomerId, s.TradeUnit, s.IsActive
                FROM [dbo].[CustomerSnapshot] s
                WHERE s.TradeUnit IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM [dbo].[CustomerTradeUnit] ctu
                      WHERE ctu.CustomerId = s.CustomerId AND ctu.TradeUnit = s.TradeUnit
                  );
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerTradeUnit",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "Customer",
                schema: "dbo");
        }
    }
}
