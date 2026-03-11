using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class ReshapeAppTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
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
                    SourceCustomerId = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    IndustryCode1 = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    EffectiveStartDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    EffectiveEndDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    MerchandisingPhone = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingEmail = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedPrimaryPhone = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SupplementalEmail = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingCity = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingStateProvince = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingAddressLine1 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MerchandisingPostalCode = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedAddressLine1 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedAddressLine2 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedAddressLine3 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedAddressLine4 = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedCity = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedPostalCode = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedStateProvince = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExtendedCountry = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    TradeUnit = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    SnapshotRefreshedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerSnapshot", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerSnapshot",
                schema: "dbo");
        }
    }
}
