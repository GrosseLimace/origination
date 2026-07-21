using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNotesPerfIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Notes_CreatedBy_CreatedAt",
                schema: "dbo",
                table: "Notes",
                columns: new[] { "CreatedBy", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Notes_CustomerId_CreatedAt",
                schema: "dbo",
                table: "Notes",
                columns: new[] { "CustomerId", "CreatedAt" },
                filter: "[IsDeleted] = 0")
                .Annotation("SqlServer:Include", new[] { "TradeUnit" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Notes_CreatedBy_CreatedAt",
                schema: "dbo",
                table: "Notes");

            migrationBuilder.DropIndex(
                name: "IX_Notes_CustomerId_CreatedAt",
                schema: "dbo",
                table: "Notes");
        }
    }
}
