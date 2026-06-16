using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class DropRedundantCustomerColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Drop the redundant denormalized columns. After Phase 3a these are no
            // longer read or written by the app — CustomerName / CustomerCode / ScoularId
            // come from the dbo.Customer FK join, and LinkedProducerIds is composed
            // from dbo.CustomerLink. IF COL_LENGTH guards make this idempotent / safe
            // in environments where the columns were dropped manually.
            migrationBuilder.Sql(@"
                IF COL_LENGTH('dbo.ProducerPlantingIntentions', 'CustomerCode') IS NOT NULL
                    ALTER TABLE [dbo].[ProducerPlantingIntentions] DROP COLUMN [CustomerCode];
            ");
            migrationBuilder.Sql(@"
                IF COL_LENGTH('dbo.ProducerPlantingIntentions', 'CustomerName') IS NOT NULL
                    ALTER TABLE [dbo].[ProducerPlantingIntentions] DROP COLUMN [CustomerName];
            ");
            migrationBuilder.Sql(@"
                IF COL_LENGTH('dbo.ProducerDetails', 'CustomerName') IS NOT NULL
                    ALTER TABLE [dbo].[ProducerDetails] DROP COLUMN [CustomerName];
            ");
            migrationBuilder.Sql(@"
                IF COL_LENGTH('dbo.ProducerDetails', 'LinkedProducerIds') IS NOT NULL
                    ALTER TABLE [dbo].[ProducerDetails] DROP COLUMN [LinkedProducerIds];
            ");
            migrationBuilder.Sql(@"
                IF COL_LENGTH('dbo.ProducerDetails', 'ScoularId') IS NOT NULL
                    ALTER TABLE [dbo].[ProducerDetails] DROP COLUMN [ScoularId];
            ");
            migrationBuilder.Sql(@"
                IF COL_LENGTH('dbo.Notes', 'CustomerCode') IS NOT NULL
                    ALTER TABLE [dbo].[Notes] DROP COLUMN [CustomerCode];
            ");
            migrationBuilder.Sql(@"
                IF COL_LENGTH('dbo.Notes', 'CustomerName') IS NOT NULL
                    ALTER TABLE [dbo].[Notes] DROP COLUMN [CustomerName];
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CustomerCode",
                schema: "dbo",
                table: "ProducerPlantingIntentions",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "CustomerName",
                schema: "dbo",
                table: "ProducerPlantingIntentions",
                type: "nvarchar(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "CustomerName",
                schema: "dbo",
                table: "ProducerDetails",
                type: "nvarchar(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "LinkedProducerIds",
                schema: "dbo",
                table: "ProducerDetails",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScoularId",
                schema: "dbo",
                table: "ProducerDetails",
                type: "nvarchar(400)",
                maxLength: 400,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomerCode",
                schema: "dbo",
                table: "Notes",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomerName",
                schema: "dbo",
                table: "Notes",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");
        }
    }
}
