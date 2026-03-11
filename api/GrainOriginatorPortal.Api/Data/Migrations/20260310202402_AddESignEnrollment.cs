using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddESignEnrollment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Table is managed by Power Automate; create only if it doesn't already exist
            migrationBuilder.Sql(@"
                IF OBJECT_ID(N'[dbo].[eSignEnrollment]') IS NULL
                BEGIN
                    CREATE TABLE [dbo].[eSignEnrollment] (
                        [Id] int NOT NULL IDENTITY,
                        [CustomerCode] nvarchar(50) NOT NULL,
                        [CustomerName] nvarchar(255) NOT NULL,
                        [eSignEnabled] bit NOT NULL,
                        [ScoularViewRecipients] nvarchar(max) NULL,
                        [GUID] nvarchar(255) NULL,
                        [UpdatedOn] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
                        CONSTRAINT [PK_eSignEnrollment] PRIMARY KEY ([Id])
                    );
                    CREATE UNIQUE INDEX [UQ_eSignEnrollment_CustomerCode]
                        ON [dbo].[eSignEnrollment] ([CustomerCode]);
                END
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "eSignEnrollment",
                schema: "dbo");
        }
    }
}
