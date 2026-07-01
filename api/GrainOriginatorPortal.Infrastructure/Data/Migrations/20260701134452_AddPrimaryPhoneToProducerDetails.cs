using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the free-text <c>PrimaryPhone</c> column to dbo.ProducerDetails — a user-entered phone
    /// for the primary contact, kept alongside (not replacing) the pulled-in ODS phone. Guarded so
    /// it's idempotent if the column was added by hand in an environment before deploy runs it.
    /// </summary>
    public partial class AddPrimaryPhoneToProducerDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.ProducerDetails', 'PrimaryPhone') IS NULL
    ALTER TABLE dbo.ProducerDetails ADD PrimaryPhone NVARCHAR(50) NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.ProducerDetails', 'PrimaryPhone') IS NOT NULL
    ALTER TABLE dbo.ProducerDetails DROP COLUMN PrimaryPhone;");
        }
    }
}
