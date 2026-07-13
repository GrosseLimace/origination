using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Seeds the "ACH Payment" curated prompt into dbo.QueryLibrary (General section). Selecting it runs
    /// its QueryText through the NLQ engine, which now filters producers to those whose ODS PaymentMethod
    /// is 'H' (ACH). Guarded by NOT EXISTS on QueryText so re-running (or running after a manual add) is a no-op.
    /// </summary>
    public partial class AddAchPaymentQueryLibraryItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
INSERT INTO dbo.QueryLibrary (Category, Name, Description, QueryText, Tags, SortOrder, IsActive, CreatedAt)
SELECT v.Category, v.Name, v.Description, v.QueryText, v.Tags, v.SortOrder, 1, SYSUTCDATETIME()
FROM (VALUES
    ('General', 'ACH payment', 'Producers set up with the ACH payment method.', 'Producers with ACH payment', 'ach,payment', 90)
) AS v(Category, Name, Description, QueryText, Tags, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM dbo.QueryLibrary q WHERE q.QueryText = v.QueryText);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM dbo.QueryLibrary WHERE QueryText = 'Producers with ACH payment';");
        }
    }
}
