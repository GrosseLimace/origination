using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBidSheetShareMemberType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BidSheetShares_MemberUserId",
                schema: "dbo",
                table: "BidSheetShares");

            migrationBuilder.DropIndex(
                name: "UQ_BidSheetShares_Sheet_Member",
                schema: "dbo",
                table: "BidSheetShares");

            migrationBuilder.RenameColumn(
                name: "MemberUserId",
                schema: "dbo",
                table: "BidSheetShares",
                newName: "MemberId");

            // defaultValue is "person", NOT the "" EF scaffolded. Every row that already exists is a
            // person share by construction -- this column was people-only until now -- and "" is not a
            // type the visibility predicate matches, so backfilling blank would have silently revoked
            // access for everyone already shared on a sheet. The column keeps the default afterwards as
            // a belt-and-braces measure; the entity sets it explicitly on every insert anyway.
            migrationBuilder.AddColumn<string>(
                name: "MemberType",
                schema: "dbo",
                table: "BidSheetShares",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "person");

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetShares_Member",
                schema: "dbo",
                table: "BidSheetShares",
                columns: new[] { "MemberType", "MemberId" });

            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetShares_Sheet_Member",
                schema: "dbo",
                table: "BidSheetShares",
                columns: new[] { "BidSheetId", "MemberType", "MemberId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BidSheetShares_Member",
                schema: "dbo",
                table: "BidSheetShares");

            migrationBuilder.DropIndex(
                name: "UQ_BidSheetShares_Sheet_Member",
                schema: "dbo",
                table: "BidSheetShares");

            migrationBuilder.DropColumn(
                name: "MemberType",
                schema: "dbo",
                table: "BidSheetShares");

            migrationBuilder.RenameColumn(
                name: "MemberId",
                schema: "dbo",
                table: "BidSheetShares",
                newName: "MemberUserId");

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetShares_MemberUserId",
                schema: "dbo",
                table: "BidSheetShares",
                column: "MemberUserId");

            migrationBuilder.CreateIndex(
                name: "UQ_BidSheetShares_Sheet_Member",
                schema: "dbo",
                table: "BidSheetShares",
                columns: new[] { "BidSheetId", "MemberUserId" },
                unique: true);
        }
    }
}
