using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// One row per user holding the LATEST job title seen on their access token (the Entra
    /// <c>jobTitle</c> claim IT added to the API token — Dev 2026-10-27, QA next, PROD under a
    /// change request). Read by the usage dashboard's job-title filter. NULL JobTitle means the
    /// token carried no claim (no directory title), which the dashboard shows as "No title" rather
    /// than treating as an error. Written only when a title is first seen or changes, so the table
    /// stays at roughly one row per app user and needs no retention pruning. Safe to apply ahead
    /// of the claim: until the claim exists in an environment every row simply records NULL.
    /// </summary>
    public partial class AddUserJobTitle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserJobTitle",
                schema: "dbo",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    JobTitle = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    RecordedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserJobTitle", x => x.UserId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserJobTitle",
                schema: "dbo");
        }
    }
}
