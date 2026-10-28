using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   AddBarchartFeed
       Author:      Origination engineering
       Description: Landing tables for the BarChart daily grain-bid feed plus the Bid Sheet columns
                    that link a location to the feed and record each bid's provenance.
       Rollback:    Down() drops the five dbo.Barchart* tables, the two views, the four Bid Sheet
                    columns and their index. Existing Bid Sheet data is unaffected either way.
    */

    /// <summary>
    /// Creates the BarChart bid-feed landing tables (<c>dbo.BarchartInstrument</c>,
    /// <c>BarchartCurrentQuote</c>, <c>BarchartQuoteSnapshot</c>, <c>BarchartCommodityMap</c>,
    /// <c>BarchartApiCallAudit</c>), two read views, and the Bid Sheet link/provenance columns.
    ///
    /// Vendor data is loaded by the ingest API (<c>api/barchart-ingest</c>) using parameterized SQL in
    /// <c>BarchartIngestRepository</c> — deliberately not stored procedures, because the App Service
    /// managed identity holds read/write but not EXECUTE on this database.
    ///
    /// The Bid Sheet columns carry the ownership rule: <c>Source</c> marks a bid cell as
    /// <c>'Manual'</c> (user-owned, never touched by the feed) or <c>'Barchart'</c> (feed-owned,
    /// read-only to users). Existing rows backfill as <c>'Manual'</c> via the column default, so
    /// nothing about today's behavior changes.
    ///
    /// See docs/application-context/Barchart Bid Feed - Database Plan.md.
    /// </summary>
    public partial class AddBarchartFeed : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Bid Sheet link + provenance columns. Added explicitly: the model snapshot already
            // carried these (they were configured on this branch before it was rebased onto main),
            // so the scaffolder saw no diff for them.
            migrationBuilder.AddColumn<string>(
                name: "BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Manual");

            migrationBuilder.AddColumn<string>(
                name: "BarchartSymbol",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "QuoteAsOf",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "datetime2",
                nullable: true);

            // Non-unique: the same BarChart location may be placed in several trade units,
            // one row per placement.
            migrationBuilder.CreateIndex(
                name: "IX_BidSheetLocations_BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations",
                column: "BarchartLocationKey");

            migrationBuilder.CreateTable(
                name: "BarchartApiCallAudit",
                schema: "dbo",
                columns: table => new
                {
                    ApiCallId = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CalledAtUtc = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    Endpoint = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    QueryParams = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    HttpStatus = table.Column<int>(type: "int", nullable: true),
                    Success = table.Column<bool>(type: "bit", nullable: false),
                    RowsAffected = table.Column<int>(type: "int", nullable: true),
                    DurationMs = table.Column<int>(type: "int", nullable: true),
                    ErrorMessage = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BarchartApiCallAudit", x => x.ApiCallId);
                });

            migrationBuilder.CreateTable(
                name: "BarchartCommodityMap",
                schema: "dbo",
                columns: table => new
                {
                    BarchartCommodity = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    CommodityCode = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CommodityName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CommodityCategory = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    CreatedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    ModifiedAt = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    ModifiedBy = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BarchartCommodityMap", x => x.BarchartCommodity);
                });

            migrationBuilder.CreateTable(
                name: "BarchartInstrument",
                schema: "dbo",
                columns: table => new
                {
                    Symbol = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    LocationKey = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Root = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    InstrumentType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    DeliveryWindowFlag = table.Column<string>(type: "char(1)", nullable: true),
                    SymbolDescription = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    Elevator = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    LocationName = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    FacilityType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    Commodity = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    UnderlyingFuture = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    DeliveryStart = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    DeliveryEnd = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    Address = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    City = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    State = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    ZipCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Latitude = table.Column<double>(type: "float", nullable: true),
                    Longitude = table.Column<double>(type: "float", nullable: true),
                    County = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    StateFips = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    CountyFips = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    Phone = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Website = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    IsTest = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    FirstSeenUtc = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()"),
                    LastSeenUtc = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BarchartInstrument", x => x.Symbol);
                });

            migrationBuilder.CreateTable(
                name: "BarchartCurrentQuote",
                schema: "dbo",
                columns: table => new
                {
                    Symbol = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    LastPrice = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    NetChange = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    PercentChange = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    OpenPrice = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    HighPrice = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    LowPrice = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    ClosePrice = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    UnitCode = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    DayCode = table.Column<string>(type: "nvarchar(5)", maxLength: 5, nullable: true),
                    QuoteMode = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    QuoteFlag = table.Column<string>(type: "nvarchar(5)", maxLength: 5, nullable: true),
                    TradeTimestamp = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    ServerTimestamp = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BarchartCurrentQuote", x => x.Symbol);
                    table.ForeignKey(
                        name: "FK_BarchartCurrentQuote_BarchartInstrument",
                        column: x => x.Symbol,
                        principalSchema: "dbo",
                        principalTable: "BarchartInstrument",
                        principalColumn: "Symbol",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BarchartQuoteSnapshot",
                schema: "dbo",
                columns: table => new
                {
                    SnapshotDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Symbol = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    LastPrice = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    NetChange = table.Column<decimal>(type: "decimal(19,4)", precision: 19, scale: 4, nullable: true),
                    TradeTimestamp = table.Column<DateTime>(type: "datetime2(3)", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", nullable: false, defaultValueSql: "SYSUTCDATETIME()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BarchartQuoteSnapshot", x => new { x.SnapshotDate, x.Symbol });
                    table.ForeignKey(
                        name: "FK_BarchartQuoteSnapshot_BarchartInstrument",
                        column: x => x.Symbol,
                        principalSchema: "dbo",
                        principalTable: "BarchartInstrument",
                        principalColumn: "Symbol",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BarchartApiCallAudit_CalledAtUtc",
                schema: "dbo",
                table: "BarchartApiCallAudit",
                column: "CalledAtUtc")
                .Annotation("SqlServer:Include", new[] { "Endpoint", "Success" });

            migrationBuilder.CreateIndex(
                name: "IX_BarchartCurrentQuote_TradeTimestamp",
                schema: "dbo",
                table: "BarchartCurrentQuote",
                column: "TradeTimestamp",
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "IX_BarchartInstrument_LocationKey",
                schema: "dbo",
                table: "BarchartInstrument",
                column: "LocationKey")
                .Annotation("SqlServer:Include", new[] { "Commodity", "InstrumentType", "IsActive", "IsTest" });

            migrationBuilder.CreateIndex(
                name: "IX_BarchartInstrument_State_City",
                schema: "dbo",
                table: "BarchartInstrument",
                columns: new[] { "State", "City" });

            migrationBuilder.CreateIndex(
                name: "IX_BarchartQuoteSnapshot_Symbol_SnapshotDate",
                schema: "dbo",
                table: "BarchartQuoteSnapshot",
                columns: new[] { "Symbol", "SnapshotDate" },
                descending: new[] { false, true });

            // ── Views (hand-written; EF does not scaffold views) ─────────────────────────
            // One row per elevator LISTING rather than per bid. BarchartInstrument holds one row
            // per elevator x commodity x delivery window, so a single elevator is many rows; this
            // collapses them by LocationKey for location search and freshness reporting.
            // Test rows and deactivated symbols are excluded, so nothing app-facing can see them.
            migrationBuilder.Sql(@"
CREATE OR ALTER VIEW dbo.vw_BarchartLocation AS
SELECT
    i.LocationKey,
    MAX(i.Elevator)                  AS Elevator,
    MAX(i.LocationName)              AS LocationName,
    MAX(i.FacilityType)              AS FacilityType,
    MAX(i.Address)                   AS Address,
    MAX(i.City)                      AS City,
    MAX(i.State)                     AS State,
    MAX(i.ZipCode)                   AS ZipCode,
    AVG(i.Latitude)                  AS Latitude,
    AVG(i.Longitude)                 AS Longitude,
    MAX(i.Phone)                     AS Phone,
    MAX(i.Website)                   AS Website,
    COUNT_BIG(*)                     AS ActiveInstrumentCount,
    COUNT_BIG(DISTINCT i.Commodity)  AS CommodityCount,
    MIN(i.DeliveryStart)             AS EarliestDeliveryStart,
    MAX(i.DeliveryEnd)               AS LatestDeliveryEnd,
    MAX(i.LastSeenUtc)               AS LastSeenUtc,
    MAX(q.TradeTimestamp)            AS LatestQuoteTimestamp
FROM dbo.BarchartInstrument AS i
LEFT JOIN dbo.BarchartCurrentQuote AS q
    ON q.Symbol = i.Symbol
WHERE i.IsActive = 1
  AND i.IsTest = 0
  AND i.LocationKey IS NOT NULL
GROUP BY i.LocationKey;");

            // Monthly ingest-call counts. The vendor contract caps usage at 250,000 calls/month on a
            // key shared by every environment; the calls themselves happen in the integration side's
            // pipeline, so this meters what reached us as a close proxy and cross-check.
            migrationBuilder.Sql(@"
CREATE OR ALTER VIEW dbo.vw_BarchartMonthlyApiUsage AS
SELECT
    DATEFROMPARTS(YEAR(a.CalledAtUtc), MONTH(a.CalledAtUtc), 1) AS UsageMonth,
    a.Endpoint,
    COUNT_BIG(*)                                          AS CallCount,
    SUM(CASE WHEN a.Success = 1 THEN 1 ELSE 0 END)         AS SuccessCount,
    SUM(CASE WHEN a.Success = 0 THEN 1 ELSE 0 END)         AS FailureCount
FROM dbo.BarchartApiCallAudit AS a
GROUP BY DATEFROMPARTS(YEAR(a.CalledAtUtc), MONTH(a.CalledAtUtc), 1), a.Endpoint;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW IF EXISTS dbo.vw_BarchartMonthlyApiUsage;");
            migrationBuilder.Sql("DROP VIEW IF EXISTS dbo.vw_BarchartLocation;");

            migrationBuilder.DropTable(
                name: "BarchartApiCallAudit",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "BarchartCommodityMap",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "BarchartCurrentQuote",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "BarchartQuoteSnapshot",
                schema: "dbo");

            migrationBuilder.DropTable(
                name: "BarchartInstrument",
                schema: "dbo");

            migrationBuilder.DropIndex(
                name: "IX_BidSheetLocations_BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations");

            migrationBuilder.DropColumn(
                name: "BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations");

            migrationBuilder.DropColumn(
                name: "Source",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "BarchartSymbol",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "QuoteAsOf",
                schema: "dbo",
                table: "BidSheetLocationBids");
        }
    }
}
