using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class RenameSourceCustomerIdToScoularId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Rename the column on dbo.CustomerSnapshot. sp_rename automatically preserves any
            // indexes that reference the column. Wrapped in IF EXISTS so the migration is safe
            // to re-run on environments where it has already been applied.
            migrationBuilder.Sql(@"
                IF EXISTS (
                    SELECT 1 FROM sys.columns
                    WHERE Name = 'SourceCustomerId' AND Object_ID = OBJECT_ID('dbo.CustomerSnapshot')
                )
                    EXEC sp_rename 'dbo.CustomerSnapshot.SourceCustomerId', 'ScoularId', 'COLUMN';
            ");

            // The index name is not auto-renamed by sp_rename — sp_rename on the column updates
            // the index's column references but not the index name itself. Rename it explicitly
            // so the snapshot stays in sync with the database.
            migrationBuilder.Sql(@"
                IF EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE name = 'IX_CustomerSnapshot_SourceCustomerId'
                      AND object_id = OBJECT_ID('dbo.CustomerSnapshot')
                )
                    EXEC sp_rename N'dbo.CustomerSnapshot.IX_CustomerSnapshot_SourceCustomerId', N'IX_CustomerSnapshot_ScoularId', N'INDEX';
            ");

            // Same column rename on dbo.ProducerDetails.
            migrationBuilder.Sql(@"
                IF EXISTS (
                    SELECT 1 FROM sys.columns
                    WHERE Name = 'SourceCustomerId' AND Object_ID = OBJECT_ID('dbo.ProducerDetails')
                )
                    EXEC sp_rename 'dbo.ProducerDetails.SourceCustomerId', 'ScoularId', 'COLUMN';
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                IF EXISTS (
                    SELECT 1 FROM sys.columns
                    WHERE Name = 'ScoularId' AND Object_ID = OBJECT_ID('dbo.ProducerDetails')
                )
                    EXEC sp_rename 'dbo.ProducerDetails.ScoularId', 'SourceCustomerId', 'COLUMN';
            ");

            migrationBuilder.Sql(@"
                IF EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE name = 'IX_CustomerSnapshot_ScoularId'
                      AND object_id = OBJECT_ID('dbo.CustomerSnapshot')
                )
                    EXEC sp_rename N'dbo.CustomerSnapshot.IX_CustomerSnapshot_ScoularId', N'IX_CustomerSnapshot_SourceCustomerId', N'INDEX';
            ");

            migrationBuilder.Sql(@"
                IF EXISTS (
                    SELECT 1 FROM sys.columns
                    WHERE Name = 'ScoularId' AND Object_ID = OBJECT_ID('dbo.CustomerSnapshot')
                )
                    EXEC sp_rename 'dbo.CustomerSnapshot.ScoularId', 'SourceCustomerId', 'COLUMN';
            ");
        }
    }
}
