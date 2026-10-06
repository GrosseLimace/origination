using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Creates <c>dbo.CustomerIdSequence</c>, the source of ids for producers the customer sync finds only in CTRM.
    /// </summary>
    /// <remarks>
    /// <para><b>Why the band.</b> <c>dbo.Customer.Id</c> is the ODS surrogate id and is <c>ValueGeneratedNever</c>, so
    /// a CTRM-only producer needs an id from somewhere. Minted ids live in <c>[5e15, 6e15)</c>
    /// (<c>CustomerIdMinting</c>): far above any plausible ODS id in every environment, below the contract/ticket
    /// synthetic band (<c>CtrmSyntheticId.ReservedBase</c>, 7e15) and below 2^53 so they survive a JavaScript number.
    /// See D5 of <c>agents-docs/plans/customers-from-graphql-design_2026-10-06.md</c>.</para>
    ///
    /// <para><b>Why dynamic SQL instead of <c>CreateSequence</c>.</b> The start must come from the live table: PROD's
    /// <c>MAX(CustomerId)</c> is unknown at authoring time. The sequence starts at the larger of 5e15 and
    /// <c>MAX(CustomerId) + 1</c>, and the migration THROWs rather than create it when the table already holds an id at
    /// or above 6e15 (the band would already be occupied). <c>CREATE SEQUENCE ... START WITH</c> only takes a
    /// constant, hence <c>sp_executesql</c>. The guard on <c>sys.sequences</c> makes a re-run a no-op. The model
    /// (<c>ApplicationDbContext.OnModelCreating</c>) still declares the sequence with <c>StartsAt(ReservedBase)</c> so
    /// the snapshot stays in step; that StartsAt is a model default only, never what a database receives.</para>
    /// </remarks>
    public partial class AddCustomerIdSequence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.sequences s JOIN sys.schemas sc ON sc.schema_id = s.schema_id WHERE sc.name = N'dbo' AND s.name = N'CustomerIdSequence')
BEGIN
    DECLARE @band bigint = 5000000000000000;
    DECLARE @liveMax bigint = (SELECT ISNULL(MAX(CustomerId), 0) FROM dbo.Customer);
    IF @liveMax >= 6000000000000000
        THROW 51000, N'dbo.Customer already holds ids at or above the minted band [5e15,6e15); choose a new band in CustomerIdMinting before creating dbo.CustomerIdSequence.', 1;
    DECLARE @start bigint = CASE WHEN @liveMax >= @band THEN @liveMax + 1 ELSE @band END;
    DECLARE @sql nvarchar(500) = N'CREATE SEQUENCE dbo.CustomerIdSequence AS bigint START WITH ' + CAST(@start AS nvarchar(20))
        + N' INCREMENT BY 1 MINVALUE ' + CAST(@band AS nvarchar(20)) + N' MAXVALUE 5999999999999999 NO CYCLE CACHE 50;';
    EXEC sys.sp_executesql @sql;
END
""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP SEQUENCE IF EXISTS dbo.CustomerIdSequence;");
        }
    }
}
