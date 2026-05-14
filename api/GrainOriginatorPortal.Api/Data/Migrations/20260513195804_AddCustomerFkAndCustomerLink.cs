using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class AddCustomerFkAndCustomerLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CustomerLink",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    FromCustomerId = table.Column<long>(type: "bigint", nullable: false),
                    ToCustomerId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerLink", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CustomerLink_Customer_From",
                        column: x => x.FromCustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                    table.ForeignKey(
                        name: "FK_CustomerLink_Customer_To",
                        column: x => x.ToCustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerLink_ToCustomerId",
                schema: "dbo",
                table: "CustomerLink",
                column: "ToCustomerId");

            migrationBuilder.CreateIndex(
                name: "UQ_CustomerLink_From_To",
                schema: "dbo",
                table: "CustomerLink",
                columns: new[] { "FromCustomerId", "ToCustomerId" },
                unique: true);

            // -----------------------------------------------------------------
            // Backfill dbo.CustomerLink from ProducerDetails.LinkedProducerIds.
            // The CSV stores ScoularIds; resolve each to a CustomerId via the
            // dbo.Customer table. Idempotent via NOT EXISTS so re-running is safe.
            // (Phase 2b dropped CustomerSnapshot — Customer is now the canonical
            // source of the ScoularId → CustomerId mapping.)
            // -----------------------------------------------------------------
            migrationBuilder.Sql(@"
                INSERT INTO [dbo].[CustomerLink] (FromCustomerId, ToCustomerId)
                SELECT DISTINCT pd.CustomerId AS FromCustomerId, c.CustomerId AS ToCustomerId
                FROM [dbo].[ProducerDetails] pd
                CROSS APPLY STRING_SPLIT(LTRIM(RTRIM(pd.LinkedProducerIds)), ',') AS s
                INNER JOIN [dbo].[Customer] c ON c.ScoularId = LTRIM(RTRIM(s.value))
                WHERE pd.LinkedProducerIds IS NOT NULL
                  AND pd.LinkedProducerIds <> ''
                  AND LTRIM(RTRIM(s.value)) <> ''
                  AND NOT EXISTS (
                      SELECT 1 FROM [dbo].[CustomerLink] cl
                      WHERE cl.FromCustomerId = pd.CustomerId
                        AND cl.ToCustomerId = c.CustomerId
                  );
            ");

            // -----------------------------------------------------------------
            // FK constraints to dbo.Customer for the three customer-anchored
            // tables. Use WITH NOCHECK so existing orphan rows (rows whose
            // CustomerId isn't currently in dbo.Customer) don't block the
            // migration. New inserts / updates are still validated.
            //
            // Orphans typically come from ODS-side customer removals after the
            // Note/ProducerDetails/PlantingIntention row was created. Run the
            // populate endpoint to repopulate dbo.Customer from ODS and then
            // re-validate with WITH CHECK CHECK CONSTRAINT if a clean state
            // is desired.
            //
            // IF NOT EXISTS guards make this idempotent.
            // -----------------------------------------------------------------
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Notes_Customer_CustomerId')
                BEGIN
                    ALTER TABLE [dbo].[Notes] WITH NOCHECK
                        ADD CONSTRAINT [FK_Notes_Customer_CustomerId]
                        FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customer]([CustomerId]);
                END
            ");

            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ProducerDetails_Customer_CustomerId')
                BEGIN
                    ALTER TABLE [dbo].[ProducerDetails] WITH NOCHECK
                        ADD CONSTRAINT [FK_ProducerDetails_Customer_CustomerId]
                        FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customer]([CustomerId]);
                END
            ");

            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ProducerPlantingIntentions_Customer_CustomerId')
                BEGIN
                    ALTER TABLE [dbo].[ProducerPlantingIntentions] WITH NOCHECK
                        ADD CONSTRAINT [FK_ProducerPlantingIntentions_Customer_CustomerId]
                        FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customer]([CustomerId]);
                END
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Notes_Customer_CustomerId",
                schema: "dbo",
                table: "Notes");

            migrationBuilder.DropForeignKey(
                name: "FK_ProducerDetails_Customer_CustomerId",
                schema: "dbo",
                table: "ProducerDetails");

            migrationBuilder.DropForeignKey(
                name: "FK_ProducerPlantingIntentions_Customer_CustomerId",
                schema: "dbo",
                table: "ProducerPlantingIntentions");

            migrationBuilder.DropTable(
                name: "CustomerLink",
                schema: "dbo");
        }
    }
}
