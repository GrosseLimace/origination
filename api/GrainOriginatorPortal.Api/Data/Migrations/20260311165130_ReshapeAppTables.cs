using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Migrations.ApplicationDb
{
    /// <inheritdoc />
    public partial class ReshapeAppTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guard: CustomerSnapshot may have been created manually before this migration was tracked
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CustomerSnapshot' AND schema_id = SCHEMA_ID('dbo'))
                BEGIN
                    EXEC('CREATE TABLE [dbo].[CustomerSnapshot] (
                        [Id] int NOT NULL IDENTITY,
                        [CustomerId] bigint NOT NULL,
                        [CustomerName] nvarchar(500) NOT NULL,
                        [SourceCustomerId] nvarchar(400) NULL,
                        [IndustryCode1] nvarchar(50) NULL,
                        [IsActive] bit NOT NULL,
                        [EffectiveStartDate] datetime2 NULL,
                        [EffectiveEndDate] datetime2 NULL,
                        [MerchandisingPhone] nvarchar(max) NULL,
                        [MerchandisingEmail] nvarchar(max) NULL,
                        [ExtendedPrimaryPhone] nvarchar(max) NULL,
                        [SupplementalEmail] nvarchar(max) NULL,
                        [MerchandisingCity] nvarchar(max) NULL,
                        [MerchandisingStateProvince] nvarchar(max) NULL,
                        [MerchandisingAddressLine1] nvarchar(max) NULL,
                        [MerchandisingPostalCode] nvarchar(max) NULL,
                        [ExtendedAddressLine1] nvarchar(max) NULL,
                        [ExtendedAddressLine2] nvarchar(max) NULL,
                        [ExtendedAddressLine3] nvarchar(max) NULL,
                        [ExtendedAddressLine4] nvarchar(max) NULL,
                        [ExtendedCity] nvarchar(max) NULL,
                        [ExtendedPostalCode] nvarchar(max) NULL,
                        [ExtendedStateProvince] nvarchar(max) NULL,
                        [ExtendedCountry] nvarchar(max) NULL,
                        [TradeUnit] nvarchar(100) NULL,
                        [SnapshotRefreshedAt] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
                        CONSTRAINT [PK_CustomerSnapshot] PRIMARY KEY ([Id])
                    )')
                END
            ");
        }

/// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerSnapshot",
                schema: "dbo");
        }
    }
}
