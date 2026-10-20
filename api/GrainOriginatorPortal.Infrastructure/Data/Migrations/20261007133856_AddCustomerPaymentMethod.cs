using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds <c>dbo.Customer.PaymentMethod</c> (nvarchar(10) NULL): the CTRM payment method code the customer sync
    /// copies from GraphQL <c>paymentMethod</c> on the ctrm source when <c>CustomerSync:CtrmExtendedFields</c> is on.
    /// On ctrm the ACH badge reads it ('H' = ACH); on ods the badge still reads ODS base.Customer live and this
    /// column is unused. See E2 of <c>agents-docs/plans/customers-from-graphql-design_2026-10-06.md</c>.
    /// Guarded so it is idempotent if the column was added by hand in an environment before deploy runs it.
    /// </summary>
    public partial class AddCustomerPaymentMethod : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.Customer', 'PaymentMethod') IS NULL
    ALTER TABLE dbo.Customer ADD PaymentMethod NVARCHAR(10) NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.Customer', 'PaymentMethod') IS NOT NULL
    ALTER TABLE dbo.Customer DROP COLUMN PaymentMethod;");
        }
    }
}
