using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Links the Bid Sheet to the BarChart feed (see docs/application-context/Barchart Bid Feed -
    /// Database Plan.md): a location gains <c>BarchartLocationKey</c> (which barchart.Instrument
    /// listing it follows — non-unique, one row per trade-unit placement), and each bid gains
    /// provenance columns (<c>Source</c>, <c>BarchartSymbol</c>, <c>QuoteAsOf</c>). Existing rows
    /// backfill as Source='Manual' via the column default.
    ///
    /// Also creates <c>barchart.usp_ApplyQuotesToBidSheet</c> — the bridge, and the ONLY writer of
    /// feed data into dbo. It lives in this migration (not AddBarchartSchema) because SQL Server
    /// validates columns of existing tables at CREATE PROCEDURE time, and it references the
    /// columns added here.
    ///
    /// Ownership rule enforced across the stack: the bridge only writes rows where
    /// Source='Barchart' and never touches Manual rows; BidSheetRepository refuses user writes to
    /// Barchart rows. Each side owns its own cells.
    /// </summary>
    public partial class AddBidSheetBarchartColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

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

            migrationBuilder.AddColumn<string>(
                name: "Source",
                schema: "dbo",
                table: "BidSheetLocationBids",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Manual");

            migrationBuilder.CreateIndex(
                name: "IX_BidSheetLocations_BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations",
                column: "BarchartLocationKey");

            // The bridge: copies current BarChart prices into the bid cells of linked locations.
            // Runs after every price load (full), when a location is newly linked (@LocationId),
            // and on demand. Deterministic: same inputs always produce the same cells.
            migrationBuilder.Sql(@"
CREATE OR ALTER PROCEDURE barchart.usp_ApplyQuotesToBidSheet
    @LocationId     int           = NULL,        -- NULL = all linked locations; else just this one
    @InstrumentType nvarchar(20)  = 'bidCash',   -- v1 shows the flat posted bid; NULL = all types
    @AppliedBy      nvarchar(255) = 'barchart-feed'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Updatable single-table CTE as MERGE target: scopes both writes AND the
    -- NOT-MATCHED-BY-SOURCE delete to bid rows of linked (or the one targeted) location(s).
    ;WITH tgt AS
    (
        SELECT b.Id, b.LocationId, b.CommodityCode, b.CommodityName, b.CommodityCategory,
               b.CropYear, b.Month, b.Bid, b.Source, b.BarchartSymbol, b.QuoteAsOf,
               b.CreatedBy, b.CreatedAt, b.ModifiedBy, b.ModifiedAt
        FROM dbo.BidSheetLocationBids AS b
        WHERE EXISTS (SELECT 1 FROM dbo.BidSheetLocations AS l
                      WHERE l.Id = b.LocationId
                        AND l.BarchartLocationKey IS NOT NULL
                        AND (@LocationId IS NULL OR l.Id = @LocationId))
    ),
    src0 AS
    (
        SELECT
            loc.Id                     AS LocationId,
            m.CommodityCode,
            m.CommodityName,
            m.CommodityCategory,
            YEAR(i.DeliveryStart)      AS CropYear,
            MONTH(i.DeliveryStart)     AS BidMonth,
            i.Symbol,
            q.LastPrice,
            q.TradeTimestamp,
            -- One winner per bid cell: whole-month bids beat half-month splits, then the
            -- widest window, earliest start, freshest quote; Symbol makes the order total.
            ROW_NUMBER() OVER (
                PARTITION BY loc.Id, m.CommodityCode, YEAR(i.DeliveryStart), MONTH(i.DeliveryStart)
                ORDER BY CASE WHEN i.DeliveryWindowFlag IS NULL THEN 0 ELSE 1 END,
                         DATEDIFF(DAY, i.DeliveryStart, i.DeliveryEnd) DESC,
                         i.DeliveryStart ASC,
                         q.TradeTimestamp DESC,
                         i.Symbol ASC) AS rn
        FROM dbo.BidSheetLocations AS loc
        JOIN barchart.Instrument   AS i ON i.LocationKey = loc.BarchartLocationKey
                                       AND i.IsActive = 1 AND i.IsTest = 0
                                       AND i.DeliveryStart IS NOT NULL
                                       AND (@InstrumentType IS NULL OR i.InstrumentType = @InstrumentType)
        JOIN barchart.CurrentQuote AS q ON q.Symbol = i.Symbol AND q.LastPrice IS NOT NULL
        JOIN barchart.CommodityMap AS m ON m.BarchartCommodity = i.Commodity AND m.IsActive = 1
        WHERE loc.BarchartLocationKey IS NOT NULL
          AND (@LocationId IS NULL OR loc.Id = @LocationId)
    )
    MERGE tgt WITH (HOLDLOCK) AS t
    USING (SELECT * FROM src0 WHERE rn = 1) AS s
       ON t.LocationId = s.LocationId
      AND t.CommodityCode = s.CommodityCode
      AND t.CropYear = s.CropYear
      AND t.Month = s.BidMonth
    -- Feed-owned cells refresh; Manual cells match but hit no clause => untouched (manual wins).
    WHEN MATCHED AND t.Source = N'Barchart' THEN UPDATE SET
        t.Bid               = FORMAT(s.LastPrice, '0.00##', 'en-US'),
        t.CommodityName     = s.CommodityName,
        t.CommodityCategory = s.CommodityCategory,
        t.BarchartSymbol    = s.Symbol,
        t.QuoteAsOf         = CONVERT(datetime2, SWITCHOFFSET(s.TradeTimestamp, '+00:00')),
        t.ModifiedBy        = @AppliedBy,
        t.ModifiedAt        = SYSUTCDATETIME()
    WHEN NOT MATCHED BY TARGET THEN INSERT
        (LocationId, CommodityCode, CommodityName, CommodityCategory, CropYear, Month,
         Bid, Source, BarchartSymbol, QuoteAsOf, CreatedBy, CreatedAt)
    VALUES
        (s.LocationId, s.CommodityCode, s.CommodityName, s.CommodityCategory, s.CropYear, s.BidMonth,
         FORMAT(s.LastPrice, '0.00##', 'en-US'), N'Barchart', s.Symbol,
         CONVERT(datetime2, SWITCHOFFSET(s.TradeTimestamp, '+00:00')), @AppliedBy, SYSUTCDATETIME())
    -- Prune feed rows whose delivery month rolled off / instrument went away. Manual rows never.
    WHEN NOT MATCHED BY SOURCE AND t.Source = N'Barchart' THEN DELETE;

    SELECT @@ROWCOUNT AS RowsAffected;
END");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS barchart.usp_ApplyQuotesToBidSheet;");

            migrationBuilder.DropIndex(
                name: "IX_BidSheetLocations_BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations");

            migrationBuilder.DropColumn(
                name: "BarchartLocationKey",
                schema: "dbo",
                table: "BidSheetLocations");

            migrationBuilder.DropColumn(
                name: "BarchartSymbol",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "QuoteAsOf",
                schema: "dbo",
                table: "BidSheetLocationBids");

            migrationBuilder.DropColumn(
                name: "Source",
                schema: "dbo",
                table: "BidSheetLocationBids");
        }
    }
}
