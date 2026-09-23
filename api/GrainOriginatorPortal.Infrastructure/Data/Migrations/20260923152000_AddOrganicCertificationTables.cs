using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Landing tables for the USDA National Organic Program certification feed.
    ///
    /// Why now: the integration that resolves NOP id to certification data currently feeds CRM,
    /// and CRM is sunsetting that feature. The data has to land in Origination before it goes.
    /// The feed does not write here — it POSTs to an ingest endpoint this application owns, which
    /// keeps the app the only writer to its own database and the schema ours to change.
    ///
    /// Four tables: the operation (one row per NOP id), its scopes and its items as children, and
    /// a per-call audit table. Certification joins to a producer by NOP id rather than by
    /// customer, because one NOP id legitimately covers several customer records.
    ///
    /// No seed data. A migration seed reaches production, and fabricated certification records
    /// must never appear there.
    /// </summary>
    public partial class AddOrganicCertificationTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OrganicCertification",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AnniversaryDate = table.Column<DateTime>(type: "date", nullable: true),
                    CertificateUrl = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    CertifierName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ClientOperationId = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CustomerId = table.Column<long>(type: "bigint", nullable: true),
                    DeactivatedOn = table.Column<DateTime>(type: "datetime2", nullable: true),
                    HasCertificate = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    LoadBatchId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Nopid = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    OperationName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    OperationOtherNames = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    OperationStatus = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    ScoularId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    SourceLastUpdateDate = table.Column<DateTime>(type: "date", nullable: true),
                    StatusEffectiveDate = table.Column<DateTime>(type: "date", nullable: true),
                    TotalAcreage = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    UpdatedOn = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganicCertification", x => x.Id);
                    // NoAction: removing a customer must never silently drop certification evidence.
                    table.ForeignKey(
                        name: "FK_OrganicCertification_Customer",
                        column: x => x.CustomerId,
                        principalSchema: "dbo",
                        principalTable: "Customer",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.NoAction);
                });

            migrationBuilder.CreateTable(
                name: "OrganicCertificationItem",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CategoryId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    CategoryName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    CertificateNumber = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    ItemId = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    ItemName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true),
                    ItemVarieties = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    MadeWithOrganic = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    Organic = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    Organic100 = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    OrganicCertificationId = table.Column<int>(type: "int", nullable: false),
                    OtherItems = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    Scope = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Status = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    StatusEffectiveDate = table.Column<DateTime>(type: "date", nullable: true),
                    UpdatedOn = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganicCertificationItem", x => x.Id);
                    // Cascade, unlike the Customer FK: an item has no meaning without its parent,
                    // and the set is replaced wholesale on every ingest.
                    table.ForeignKey(
                        name: "FK_OrganicCertificationItem_OrganicCertification",
                        column: x => x.OrganicCertificationId,
                        principalSchema: "dbo",
                        principalTable: "OrganicCertification",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrganicCertificationScope",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OrganicCertificationId = table.Column<int>(type: "int", nullable: false),
                    Scope = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ScopeStatus = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    StatusEffectiveDate = table.Column<DateTime>(type: "date", nullable: true),
                    UpdatedOn = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganicCertificationScope", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrganicCertificationScope_OrganicCertification",
                        column: x => x.OrganicCertificationId,
                        principalSchema: "dbo",
                        principalTable: "OrganicCertification",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrganicCertificationLoad",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Accepted = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    BatchId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Message = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    Nopid = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    ReceivedOn = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    Rejected = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    Status = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    UnmatchedCustomer = table.Column<int>(type: "int", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    // Deliberately no FK to OrganicCertification: an audit row must survive even
                    // when the message it describes was rejected and no certification was written.
                    table.PrimaryKey("PK_OrganicCertificationLoad", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrganicCertification_CustomerId",
                schema: "dbo",
                table: "OrganicCertification",
                column: "CustomerId");

            // The upsert key.
            migrationBuilder.CreateIndex(
                name: "UQ_OrganicCertification_Nopid",
                schema: "dbo",
                table: "OrganicCertification",
                column: "Nopid",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UQ_OrganicCertificationItem_Certification_Item",
                schema: "dbo",
                table: "OrganicCertificationItem",
                columns: new[] { "OrganicCertificationId", "ItemId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrganicCertificationLoad_ReceivedOn",
                schema: "dbo",
                table: "OrganicCertificationLoad",
                column: "ReceivedOn");

            migrationBuilder.CreateIndex(
                name: "UQ_OrganicCertificationScope_Certification_Scope",
                schema: "dbo",
                table: "OrganicCertificationScope",
                columns: new[] { "OrganicCertificationId", "Scope" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Children first, then the parent, then the independent audit table.
            migrationBuilder.DropTable(
                name: "OrganicCertificationItem",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "OrganicCertificationLoad",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "OrganicCertificationScope",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "OrganicCertification",
                schema: "dbo");
        }
    }
}
