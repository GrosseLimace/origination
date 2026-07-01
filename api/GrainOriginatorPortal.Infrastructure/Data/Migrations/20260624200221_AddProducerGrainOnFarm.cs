using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class AddProducerGrainOnFarm : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProducerGrainOnFarm",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    CommodityGroup = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    BushelsOnHand = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    TargetBushels = table.Column<decimal>(type: "decimal(18,2)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProducerGrainOnFarm", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProducerGrainOnFarm_Customer",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                });

            migrationBuilder.CreateIndex(
                name: "UQ_ProducerGrainOnFarm_Customer_Group",
                schema: "dbo",
                table: "ProducerGrainOnFarm",
                columns: new[] { "CustomerId", "CommodityGroup" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProducerGrainOnFarm",
                schema: "dbo");
        }
    }
}
