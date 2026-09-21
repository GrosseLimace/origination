using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPlantingIntentionSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                schema: "dbo",
                table: "ProducerPlantingIntentions",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeletedBy",
                schema: "dbo",
                table: "ProducerPlantingIntentions",
                type: "nvarchar(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDeleted",
                schema: "dbo",
                table: "ProducerPlantingIntentions",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeletedAt",
                schema: "dbo",
                table: "ProducerPlantingIntentions");

            migrationBuilder.DropColumn(
                name: "DeletedBy",
                schema: "dbo",
                table: "ProducerPlantingIntentions");

            migrationBuilder.DropColumn(
                name: "IsDeleted",
                schema: "dbo",
                table: "ProducerPlantingIntentions");
        }
    }
}
