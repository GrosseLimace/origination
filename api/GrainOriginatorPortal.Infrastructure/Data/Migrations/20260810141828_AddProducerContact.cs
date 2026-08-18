using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Creates dbo.ProducerContact — multiple user-entered contacts per producer (name, phone,
    /// email; exactly one flagged primary) replacing the single PrimaryContact/PrimaryPhone pair as
    /// the source of truth. The legacy columns stay and are dual-written from the primary row, so
    /// customer search and phone lookups keep working until every reader is moved to this table.
    /// Seeds one primary contact row per existing ProducerDetails row that has a PrimaryContact or
    /// PrimaryPhone (idempotent NOT EXISTS guard; phone-only rows get the placeholder name
    /// 'Primary Contact' since Name is NOT NULL).
    /// </summary>
    public partial class AddProducerContact : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProducerContact",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CustomerId = table.Column<long>(type: "bigint", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Phone = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Email = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    IsPrimary = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProducerContact", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProducerContact_Customer",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "CustomerId");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProducerContact_CustomerId",
                schema: "dbo",
                table: "ProducerContact",
                column: "CustomerId");

            // Seed: carry each producer's existing primary contact/phone into the new table so the
            // UI shows it as the (starred) first row immediately after deploy. Idempotent — the
            // NOT EXISTS guard makes re-runs and reruns-after-partial-failure safe.
            migrationBuilder.Sql(@"
INSERT INTO dbo.ProducerContact (CustomerId, Name, Phone, Email, IsPrimary, SortOrder)
SELECT pd.CustomerId,
       COALESCE(NULLIF(LTRIM(RTRIM(pd.PrimaryContact)), ''), 'Primary Contact'),
       NULLIF(LTRIM(RTRIM(pd.PrimaryPhone)), ''),
       NULL,
       1,
       0
FROM dbo.ProducerDetails pd
WHERE (NULLIF(LTRIM(RTRIM(pd.PrimaryContact)), '') IS NOT NULL
       OR NULLIF(LTRIM(RTRIM(pd.PrimaryPhone)), '') IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM dbo.ProducerContact pc WHERE pc.CustomerId = pd.CustomerId);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProducerContact",
                schema: "dbo");
        }
    }
}
