using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class CreateCustomerCommodity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CustomerCommodity",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    CommodityId = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerCommodity", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CustomerCommodity_Commodity",
                        column: x => x.CommodityId,
                        principalSchema: "dbo",
                        principalTable: "Commodities",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CustomerCommodity_Customer",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerCommodity_CommodityId",
                schema: "dbo",
                table: "CustomerCommodity",
                column: "CommodityId");

            migrationBuilder.CreateIndex(
                name: "UQ_CustomerCommodity_Customer_Commodity",
                schema: "dbo",
                table: "CustomerCommodity",
                columns: new[] { "CustomerId", "CommodityId" },
                unique: true);

            // -----------------------------------------------------------------
            // Backfill dbo.CustomerCommodity from ProducerDetails.Commodities.
            // The CSV stores commodity codes; resolve each to a CommodityId via
            // the dbo.Commodities lookup table (case-insensitive). Codes not
            // present in the lookup are silently skipped — the runtime UI only
            // surfaces valid codes via the commodity-search dropdown, so any
            // mismatches in legacy data are typos / dropped entries.
            // Idempotent via NOT EXISTS so re-runs are safe.
            // -----------------------------------------------------------------
            migrationBuilder.Sql(@"
                INSERT INTO [dbo].[CustomerCommodity] (CustomerId, CommodityId)
                SELECT DISTINCT pd.CustomerId, c.Id
                FROM [dbo].[ProducerDetails] pd
                CROSS APPLY STRING_SPLIT(LTRIM(RTRIM(pd.Commodities)), ',') AS s
                INNER JOIN [dbo].[Commodities] c
                    ON c.Code = LTRIM(RTRIM(s.value))
                WHERE pd.Commodities IS NOT NULL
                  AND pd.Commodities <> ''
                  AND LTRIM(RTRIM(s.value)) <> ''
                  AND NOT EXISTS (
                      SELECT 1 FROM [dbo].[CustomerCommodity] cc
                      WHERE cc.CustomerId = pd.CustomerId
                        AND cc.CommodityId = c.Id
                  );
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerCommodity",
                schema: "dbo");
        }
    }
}
