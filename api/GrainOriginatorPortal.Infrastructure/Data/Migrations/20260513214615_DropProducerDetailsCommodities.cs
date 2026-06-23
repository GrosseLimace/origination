using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class DropProducerDetailsCommodities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Commodities CSV column is no longer read or written by the app —
            // dbo.CustomerCommodity is the canonical store. IF COL_LENGTH guard
            // for idempotency / safety in environments where the column was
            // already dropped manually.
            migrationBuilder.Sql(@"
                IF COL_LENGTH('dbo.ProducerDetails', 'Commodities') IS NOT NULL
                    ALTER TABLE [dbo].[ProducerDetails] DROP COLUMN [Commodities];
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Commodities",
                schema: "dbo",
                table: "ProducerDetails",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);
        }
    }
}
