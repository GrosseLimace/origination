using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class AddNoteSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add soft-delete columns to dbo.Notes. Guarded with IF NOT EXISTS so reruns
            // (or environments where the columns were added manually) don't error out.
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Notes') AND name = 'IsDeleted')
                BEGIN
                    ALTER TABLE [dbo].[Notes] ADD [IsDeleted] bit NOT NULL CONSTRAINT DF_Notes_IsDeleted DEFAULT(0)
                END
            ");
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Notes') AND name = 'DeletedAt')
                BEGIN
                    ALTER TABLE [dbo].[Notes] ADD [DeletedAt] datetime2 NULL
                END
            ");
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Notes') AND name = 'DeletedBy')
                BEGIN
                    ALTER TABLE [dbo].[Notes] ADD [DeletedBy] nvarchar(200) NULL
                END
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Notes_IsDeleted') ALTER TABLE [dbo].[Notes] DROP CONSTRAINT DF_Notes_IsDeleted");
            migrationBuilder.DropColumn(name: "IsDeleted", schema: "dbo", table: "Notes");
            migrationBuilder.DropColumn(name: "DeletedAt", schema: "dbo", table: "Notes");
            migrationBuilder.DropColumn(name: "DeletedBy", schema: "dbo", table: "Notes");
        }
    }
}
