using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFieldPlanDocumentVersions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FieldName",
                schema: "dbo",
                table: "FieldPlanDocument",
                type: "nvarchar(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReplacedByDocStoreId",
                schema: "dbo",
                table: "FieldPlanDocument",
                type: "nvarchar(36)",
                maxLength: 36,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                schema: "dbo",
                table: "FieldPlanDocument",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Current");

            migrationBuilder.AddColumn<DateTime>(
                name: "StatusChangedAt",
                schema: "dbo",
                table: "FieldPlanDocument",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StatusChangedBy",
                schema: "dbo",
                table: "FieldPlanDocument",
                type: "nvarchar(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StatusChangedByName",
                schema: "dbo",
                table: "FieldPlanDocument",
                type: "nvarchar(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StatusNote",
                schema: "dbo",
                table: "FieldPlanDocument",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FieldName",
                schema: "dbo",
                table: "FieldPlanDocument");

            migrationBuilder.DropColumn(
                name: "ReplacedByDocStoreId",
                schema: "dbo",
                table: "FieldPlanDocument");

            migrationBuilder.DropColumn(
                name: "Status",
                schema: "dbo",
                table: "FieldPlanDocument");

            migrationBuilder.DropColumn(
                name: "StatusChangedAt",
                schema: "dbo",
                table: "FieldPlanDocument");

            migrationBuilder.DropColumn(
                name: "StatusChangedBy",
                schema: "dbo",
                table: "FieldPlanDocument");

            migrationBuilder.DropColumn(
                name: "StatusChangedByName",
                schema: "dbo",
                table: "FieldPlanDocument");

            migrationBuilder.DropColumn(
                name: "StatusNote",
                schema: "dbo",
                table: "FieldPlanDocument");
        }
    }
}
