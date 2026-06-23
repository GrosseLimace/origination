using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class AddCustomerTradeUnitAuditColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // IDEMPOTENT by design: the four audit columns were added by hand in some environments
            // (Dev was ALTERed manually before this migration existed). Each ADD is guarded so this
            // migration ADDS the columns where they're missing (e.g. QA/Prod via the deploy pipeline)
            // and is a harmless no-op where they already exist (Dev) — in both cases the migration is
            // still recorded in __EFMigrationsHistory. NOT NULL columns get a DEFAULT so existing rows
            // backfill automatically. (Defaults match the model config; manual envs may carry an
            // equivalent SYSUTCDATETIME default, which is harmless — the app code sets the values.)
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.CustomerTradeUnit', 'CreatedAt') IS NULL
    ALTER TABLE dbo.CustomerTradeUnit
        ADD CreatedAt datetime2 NOT NULL
            CONSTRAINT DF_CustomerTradeUnit_CreatedAt DEFAULT GETUTCDATE();");

            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.CustomerTradeUnit', 'CreatedBy') IS NULL
    ALTER TABLE dbo.CustomerTradeUnit
        ADD CreatedBy nvarchar(255) NOT NULL
            CONSTRAINT DF_CustomerTradeUnit_CreatedBy DEFAULT N'';");

            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.CustomerTradeUnit', 'ModifiedAt') IS NULL
    ALTER TABLE dbo.CustomerTradeUnit ADD ModifiedAt datetime2 NULL;");

            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.CustomerTradeUnit', 'ModifiedBy') IS NULL
    ALTER TABLE dbo.CustomerTradeUnit ADD ModifiedBy nvarchar(255) NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Guarded so a rollback succeeds whether or not the columns are present. Drops the
            // default constraints first (named for the migration-created path; the IF guard skips
            // them if a manual env used different/absent constraint names).
            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.DF_CustomerTradeUnit_CreatedAt', 'D') IS NOT NULL
    ALTER TABLE dbo.CustomerTradeUnit DROP CONSTRAINT DF_CustomerTradeUnit_CreatedAt;
IF COL_LENGTH('dbo.CustomerTradeUnit', 'CreatedAt') IS NOT NULL
    ALTER TABLE dbo.CustomerTradeUnit DROP COLUMN CreatedAt;");

            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.DF_CustomerTradeUnit_CreatedBy', 'D') IS NOT NULL
    ALTER TABLE dbo.CustomerTradeUnit DROP CONSTRAINT DF_CustomerTradeUnit_CreatedBy;
IF COL_LENGTH('dbo.CustomerTradeUnit', 'CreatedBy') IS NOT NULL
    ALTER TABLE dbo.CustomerTradeUnit DROP COLUMN CreatedBy;");

            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.CustomerTradeUnit', 'ModifiedAt') IS NOT NULL
    ALTER TABLE dbo.CustomerTradeUnit DROP COLUMN ModifiedAt;");

            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.CustomerTradeUnit', 'ModifiedBy') IS NOT NULL
    ALTER TABLE dbo.CustomerTradeUnit DROP COLUMN ModifiedBy;");
        }
    }
}
