using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// Two findings from the 2026-10-13 production check, both read-only verified there first.
    /// (1) CustomerTradeUnit's FK to Customer was the only CASCADE among the ten FKs into Customer;
    /// the other nine are NO_ACTION. Those rows are hand-curated trade-unit assignments (22,491 in
    /// production), so a customer delete must be blocked by them, not silently take them along.
    /// (2) Three FKs added WITH NOCHECK in May 2026 were never revalidated; see the Up body.
    /// Down restores the cascade only; it deliberately does not un-validate the three constraints,
    /// because a trusted constraint is never the wrong state.
    /// </summary>
    public partial class RestrictCustomerTradeUnitDeleteAndValidateCustomerFks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CustomerTradeUnit_Customer_CustomerId",
                schema: "dbo",
                table: "CustomerTradeUnit");

            migrationBuilder.AddForeignKey(
                name: "FK_CustomerTradeUnit_Customer_CustomerId",
                schema: "dbo",
                table: "CustomerTradeUnit",
                column: "CustomerId",
                principalSchema: "dbo",
                principalTable: "Customer",
                principalColumn: "CustomerId");

            // Validate the three FKs that 20260513195804_AddCustomerFkAndCustomerLink added WITH NOCHECK.
            // That migration skipped checking pre-existing orphan rows and asked for a later
            // revalidation that never came, so SQL Server has carried them as "not trusted" since May.
            // Production was checked on 2026-10-13: zero orphan rows behind any of the three, so this
            // validates with nothing to clean up. WITH CHECK CHECK CONSTRAINT is the documented way
            // to turn an untrusted constraint into a trusted one; it is a no-op on a trusted one.
            // Only Production was checked; Dev and QA were not. An orphan row there would stop the
            // deploy with a bare error 547, so this guard names the cause first. Find the rows with
            // scripts/CheckCustomerFkOrphans.sql. The migration runs in one transaction, so the FK
            // swap above rolls back too and the migration can be re-run once the rows are resolved.
            migrationBuilder.Sql(@"
                IF EXISTS (SELECT 1 FROM [dbo].[Notes] n
                           WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = n.[CustomerId]))
                   OR EXISTS (SELECT 1 FROM [dbo].[ProducerDetails] p
                              WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = p.[CustomerId]))
                   OR EXISTS (SELECT 1 FROM [dbo].[ProducerPlantingIntentions] i
                              WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = i.[CustomerId]))
                BEGIN
                    THROW 50001, 'Orphan rows in Notes, ProducerDetails or ProducerPlantingIntentions reference a missing dbo.Customer. Run scripts/CheckCustomerFkOrphans.sql, resolve them, then re-run this migration.', 1;
                END;

                ALTER TABLE [dbo].[Notes] WITH CHECK CHECK CONSTRAINT [FK_Notes_Customer_CustomerId];
                ALTER TABLE [dbo].[ProducerDetails] WITH CHECK CHECK CONSTRAINT [FK_ProducerDetails_Customer_CustomerId];
                ALTER TABLE [dbo].[ProducerPlantingIntentions] WITH CHECK CHECK CONSTRAINT [FK_ProducerPlantingIntentions_Customer_CustomerId];
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CustomerTradeUnit_Customer_CustomerId",
                schema: "dbo",
                table: "CustomerTradeUnit");

            migrationBuilder.AddForeignKey(
                name: "FK_CustomerTradeUnit_Customer_CustomerId",
                schema: "dbo",
                table: "CustomerTradeUnit",
                column: "CustomerId",
                principalSchema: "dbo",
                principalTable: "Customer",
                principalColumn: "CustomerId",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
