-- =====================================================
-- BarChart commodity mapping seed
--
-- Translates BarChart's commodity STRINGS to our commodity codes. Nothing the vendor feed publishes
-- reaches the Bid Sheet without a row here: the bridge inner-joins this table, so an unmapped
-- commodity loads fine and then silently never appears as a bid.
--
-- The mapping keys off the vendor's commodity name, not the symbol root, because the root can't tell
-- "Corn (#2 Yellow)" from "Corn (NonGMO)".
--
-- Grade and protein variants deliberately collapse into their parent code (for example
-- "Wheat (Hard Red Winter, Kansas City, 11.5)" -> HRWW). Checked against the live catalog first: a
-- location publishes either the standard grade or a protein spec for a given month, never both, so
-- collapsing them can't produce two rows competing for one Bid Sheet cell (HRWW 0 collisions of 278,
-- Minneapolis-spring 0 of 134, SRWW 0 of 151, YSB 3 of 1763).
--
-- Codes confirmed by Travis 2026-08-18.
--
-- Run against: each environment's Origination DB, after the AddBarchartFeed migration.
-- Idempotent: re-running refreshes names/categories and reactivates rows, and never duplicates.
-- =====================================================

SET NOCOUNT ON;

DECLARE @seed TABLE
(
    BarchartCommodity nvarchar(200) NOT NULL PRIMARY KEY,
    CommodityCode     nvarchar(50)  NOT NULL,
    CommodityName     nvarchar(200) NULL,
    CommodityCategory nvarchar(100) NULL
);

INSERT INTO @seed (BarchartCommodity, CommodityCode, CommodityName, CommodityCategory) VALUES
    (N'Corn (#2 Yellow)',                            N'YC',   N'YELLOW CORN',                N'Corn'),
    (N'Corn (NonGMO)',                               N'YCNG', N'YELLOW CORN - NON-GMO',      N'Corn'),
    (N'Corn (White)',                                N'WC',   N'WHITE CORN',                 N'Corn'),
    (N'Soybeans (#2 Yellow)',                        N'YSB',  N'YELLOW SOYBEANS',            N'Soybeans'),
    (N'Soybeans (#1 Yellow)',                        N'YSB',  N'YELLOW SOYBEANS',            N'Soybeans'),
    (N'Soybeans (NonGMO)',                           N'NYSB', N'NON-GMO SOYBEANS',           N'Soybeans'),
    (N'Milo/Sorghum',                                N'SOR',  N'SORGHUM',                    N'Sorghum'),
    (N'Canola',                                      N'CANP', N'CANOLA',                     N'Canola'),
    (N'Wheat (Hard Red Winter, Kansas City)',        N'HRWW', N'HARD RED WINTER WHEAT',      N'Wheat'),
    (N'Wheat (#1 Hard Red Winter, Kansas City)',     N'HRWW', N'HARD RED WINTER WHEAT',      N'Wheat'),
    (N'Wheat (Hard Red Winter, Kansas City, 11.5)',  N'HRWW', N'HARD RED WINTER WHEAT',      N'Wheat'),
    (N'Wheat (Soft Red Winter, Chicago)',            N'SRWW', N'SOFT RED WINTER WHEAT',      N'Wheat'),
    (N'Wheat (Soft Red Winter, Chicago, 10.5)',      N'SRWW', N'SOFT RED WINTER WHEAT',      N'Wheat'),
    (N'Wheat (Spring, Dark Northern)',               N'DNSW', N'DARK NORTHERN SPRING WHEAT', N'Wheat'),
    (N'Wheat (Spring, Minneapolis)',                 N'DNSW', N'DARK NORTHERN SPRING WHEAT', N'Wheat'),
    (N'Wheat (#1 Spring, Minneapolis)',              N'DNSW', N'DARK NORTHERN SPRING WHEAT', N'Wheat'),
    (N'Wheat (Spring, Minneapolis, 14.0)',           N'DNSW', N'DARK NORTHERN SPRING WHEAT', N'Wheat'),
    (N'Wheat (Soft White)',                          N'SWW',  N'SOFT WHITE WHEAT',           N'Wheat'),
    (N'Wheat (Hard White)',                          N'HWW',  N'HARD WHITE WHEAT',           N'Wheat');

MERGE dbo.BarchartCommodityMap WITH (HOLDLOCK) AS t
USING @seed AS s
   ON t.BarchartCommodity = s.BarchartCommodity
-- Only writes when something actually differs, so a re-run doesn't churn ModifiedAt across every row.
WHEN MATCHED AND (ISNULL(t.CommodityCode, N'')     <> s.CommodityCode
              OR  ISNULL(t.CommodityName, N'')     <> ISNULL(s.CommodityName, N'')
              OR  ISNULL(t.CommodityCategory, N'') <> ISNULL(s.CommodityCategory, N'')
              OR  t.IsActive = 0)
    THEN UPDATE SET
        t.CommodityCode     = s.CommodityCode,
        t.CommodityName     = s.CommodityName,
        t.CommodityCategory = s.CommodityCategory,
        t.IsActive          = 1,
        t.ModifiedBy        = N'barchart-seed',
        t.ModifiedAt        = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN INSERT
    (BarchartCommodity, CommodityCode, CommodityName, CommodityCategory, IsActive, CreatedBy, CreatedAt)
VALUES
    (s.BarchartCommodity, s.CommodityCode, s.CommodityName, s.CommodityCategory, 1, N'barchart-seed', SYSUTCDATETIME());

-- Deliberately no "NOT MATCHED BY SOURCE" clause: rows added by hand in an environment are somebody's
-- decision, and this script has no business switching them off.

SELECT ActiveMappings = COUNT(*) FROM dbo.BarchartCommodityMap WHERE IsActive = 1;

-- Coverage check. Run after a catalog load; before one the instrument table is empty and this is 0/0.
SELECT
    VendorCommodity = ISNULL(NULLIF(i.Commodity, N''), N'(blank - vendor left it empty)'),
    Locations       = COUNT(DISTINCT i.LocationKey),
    Instruments     = COUNT(*),
    Mapped          = CASE WHEN EXISTS (SELECT 1 FROM dbo.BarchartCommodityMap AS m
                                        WHERE m.BarchartCommodity = i.Commodity AND m.IsActive = 1)
                           THEN N'yes' ELSE N'NO - will not reach the Bid Sheet' END
FROM dbo.BarchartInstrument AS i
WHERE i.IsActive = 1
  AND i.IsTest = 0
GROUP BY i.Commodity
ORDER BY Mapped, Locations DESC;

-- Known and intentionally unmapped as of 2026-08-18, both raised with the vendor rather than guessed:
--   "" (blank)     25 locations, all CHS United Plains Ag. The mapping key IS the commodity string, so
--                  a rule for empty would silently catch any future blank from any publisher and misfile
--                  it. Their descriptions read as HRW wheat, but that is an inference, not vendor data.
--   "Soybean Meal" 11 locations. Only protein-specific codes exist on our side (465M at 46.5%, 475M at
--                  47.5%) and the vendor states no protein; it is also a product Scoular sells rather
--                  than a crop bought from farmers.
