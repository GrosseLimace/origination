using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Creates dbo.ProducerBinSite — up to three user-entered on-farm bin sites per producer, each
    /// an optional name plus a latitude/longitude pair stored as decimal(9,6). Shown under the
    /// producer address as Google Maps links. FK to dbo.Customer (NoAction, hand-cascaded by the
    /// producer-details delete, like ProducerContact). No seed data — the table starts empty.
    /// </summary>
    public partial class AddProducerBinSite : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProducerBinSite",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    Latitude = table.Column<decimal>(type: "decimal(9,6)", nullable: false),
                    Longitude = table.Column<decimal>(type: "decimal(9,6)", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProducerBinSite", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProducerBinSite_Customer",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProducerBinSite_CustomerId",
                schema: "dbo",
                table: "ProducerBinSite",
                column: "CustomerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProducerBinSite",
                schema: "dbo");
        }
    }
}
