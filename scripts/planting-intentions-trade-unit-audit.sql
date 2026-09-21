-- =============================================================================
-- Planting intentions: trade-unit attribution audit
-- Target: the Origination application DB (Dev / QA / Prod). READ-ONLY — no data changes.
--
-- Why: until this fix, the API stamped each planting-intention row with whichever of the
-- producer's trade units the database returned first, ignoring the originator's choice. For a
-- producer on one trade unit that is always right. For a producer on two or more it was
-- arbitrary. The dashboard now sums acres by the trade unit on the row, so those rows need a
-- human to confirm or move them (profile > Planting > Edit > Trade Unit). Nothing is rewritten
-- automatically.
--
-- Result sets:
--   0. Counts per section.
--   A. Ambiguous tags — rows whose producer has 2+ active trade units. Business re-tags as needed.
--   B. Orphaned tags — rows tagged to a trade unit the producer is NOT currently active in.
--      These count on no single-trade-unit dashboard view until re-tagged.
--   C. Blank tags — rows with no trade unit at all (legacy). These still count under the
--      producer's membership, as before the fix.
-- =============================================================================
SET NOCOUNT ON;

-- Producers with 2+ active trade units, with the list of them.
WITH MultiTu AS (
    SELECT ctu.CustomerId,
           COUNT(*)                                                     AS ActiveTradeUnitCount,
           STRING_AGG(ctu.TradeUnit, ', ') WITHIN GROUP (ORDER BY ctu.TradeUnit) AS ActiveTradeUnits
    FROM dbo.CustomerTradeUnit ctu
    WHERE ctu.IsActive = 1
    GROUP BY ctu.CustomerId
    HAVING COUNT(*) >= 2
),
Orphaned AS (
    SELECT pi.Id
    FROM dbo.ProducerPlantingIntentions pi
    WHERE pi.TradeUnit <> ''
      AND NOT EXISTS (
            SELECT 1 FROM dbo.CustomerTradeUnit ctu
            WHERE ctu.CustomerId = pi.CustomerId
              AND ctu.IsActive = 1
              AND ctu.TradeUnit = pi.TradeUnit)
)
-- 0. Summary
SELECT 'A. Ambiguous (producer on 2+ trade units)' AS Section,
       COUNT(*) AS Rows_, SUM(pi.Acres) AS Acres
FROM dbo.ProducerPlantingIntentions pi
JOIN MultiTu m ON m.CustomerId = pi.CustomerId
UNION ALL
SELECT 'B. Orphaned (tag not among producer''s active trade units)',
       COUNT(*), SUM(pi.Acres)
FROM dbo.ProducerPlantingIntentions pi
JOIN Orphaned o ON o.Id = pi.Id
UNION ALL
SELECT 'C. Blank tag', COUNT(*), SUM(pi.Acres)
FROM dbo.ProducerPlantingIntentions pi
WHERE pi.TradeUnit = '';

-- A. Ambiguous tags — hand this list to the business.
WITH MultiTu AS (
    SELECT ctu.CustomerId,
           STRING_AGG(ctu.TradeUnit, ', ') WITHIN GROUP (ORDER BY ctu.TradeUnit) AS ActiveTradeUnits
    FROM dbo.CustomerTradeUnit ctu
    WHERE ctu.IsActive = 1
    GROUP BY ctu.CustomerId
    HAVING COUNT(*) >= 2
)
SELECT pi.Id            AS IntentionId,
       pi.CustomerId,
       c.ScoularId      AS CustomerCode,
       c.Name           AS CustomerName,
       pi.PlantingYear,
       pi.Crop,
       pi.[Type],
       pi.Category,
       pi.Acres,
       pi.TradeUnit     AS CurrentTradeUnit,
       m.ActiveTradeUnits AS ProducerTradeUnits,
       pi.CreatedBy, pi.CreatedAt, pi.ModifiedBy, pi.ModifiedAt
FROM dbo.ProducerPlantingIntentions pi
JOIN MultiTu m       ON m.CustomerId = pi.CustomerId
LEFT JOIN dbo.Customer c ON c.Id = pi.CustomerId
ORDER BY c.Name, pi.PlantingYear DESC, pi.Crop, pi.[Type];

-- B. Orphaned tags — includes whether the producer was removed from that trade unit by a user
--    (UserDeactivated) and when, if an inactive membership row still exists.
SELECT pi.Id            AS IntentionId,
       pi.CustomerId,
       c.ScoularId      AS CustomerCode,
       c.Name           AS CustomerName,
       pi.PlantingYear,
       pi.Crop,
       pi.[Type],
       pi.Acres,
       pi.TradeUnit     AS CurrentTradeUnit,
       (SELECT STRING_AGG(a.TradeUnit, ', ') WITHIN GROUP (ORDER BY a.TradeUnit)
          FROM dbo.CustomerTradeUnit a
         WHERE a.CustomerId = pi.CustomerId AND a.IsActive = 1) AS ProducerActiveTradeUnits,
       inactive.UserDeactivated AS RemovedByUser,
       inactive.ModifiedAt      AS MembershipDeactivatedAt,
       pi.CreatedBy, pi.CreatedAt, pi.ModifiedBy, pi.ModifiedAt
FROM dbo.ProducerPlantingIntentions pi
LEFT JOIN dbo.Customer c ON c.Id = pi.CustomerId
OUTER APPLY (
    SELECT TOP 1 i.UserDeactivated, i.ModifiedAt
    FROM dbo.CustomerTradeUnit i
    WHERE i.CustomerId = pi.CustomerId AND i.TradeUnit = pi.TradeUnit AND i.IsActive = 0
    ORDER BY i.ModifiedAt DESC
) inactive
WHERE pi.TradeUnit <> ''
  AND NOT EXISTS (
        SELECT 1 FROM dbo.CustomerTradeUnit ctu
        WHERE ctu.CustomerId = pi.CustomerId
          AND ctu.IsActive = 1
          AND ctu.TradeUnit = pi.TradeUnit)
ORDER BY c.Name, pi.PlantingYear DESC, pi.Crop;

-- C. Blank tags.
SELECT pi.Id            AS IntentionId,
       pi.CustomerId,
       c.ScoularId      AS CustomerCode,
       c.Name           AS CustomerName,
       pi.PlantingYear,
       pi.Crop,
       pi.[Type],
       pi.Acres,
       (SELECT STRING_AGG(a.TradeUnit, ', ') WITHIN GROUP (ORDER BY a.TradeUnit)
          FROM dbo.CustomerTradeUnit a
         WHERE a.CustomerId = pi.CustomerId AND a.IsActive = 1) AS ProducerActiveTradeUnits,
       pi.CreatedBy, pi.CreatedAt
FROM dbo.ProducerPlantingIntentions pi
LEFT JOIN dbo.Customer c ON c.Id = pi.CustomerId
WHERE pi.TradeUnit = ''
ORDER BY c.Name, pi.PlantingYear DESC, pi.Crop;
