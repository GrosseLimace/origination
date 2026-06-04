using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class AddUserDeactivatedToCustomerTradeUnit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Additive, non-breaking: marks a sync-sourced CustomerTradeUnit membership that a user
            // removed while the producer was dormant in that TU (no open contract / unapplied ticket).
            // Default false => every existing row is unaffected and all current behavior is unchanged
            // until the new dormant-removal path writes it. Down simply drops the column.
            migrationBuilder.AddColumn<bool>(
                name: "UserDeactivated",
                schema: "dbo",
                table: "CustomerTradeUnit",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UserDeactivated",
                schema: "dbo",
                table: "CustomerTradeUnit");
        }
    }
}
