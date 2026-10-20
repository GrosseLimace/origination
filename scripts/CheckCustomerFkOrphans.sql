-- =============================================================================
-- Customer FK orphan check
-- Target: the Origination application DB (Dev / QA / Prod). READ-ONLY — no data changes.
--
-- Why: migration 20261013163045_RestrictCustomerTradeUnitDeleteAndValidateCustomerFks runs
-- WITH CHECK CHECK CONSTRAINT on the three FKs below. They were added WITH NOCHECK in May 2026
-- because orphan rows existed then. Any orphan still present makes the migration THROW, which
-- stops the deploy job. Run this in each environment before deploying that migration.
--
-- Production was checked on 2026-10-13 (zero). Dev and QA have not been.
--
-- Result sets:
--   0. Orphan counts per table. All three must be 0 for the migration to apply.
--   A. The orphan rows themselves (only when there are any), to decide fix-up vs delete.
-- =============================================================================

SET NOCOUNT ON;

-- 0. Counts
SELECT 'Notes' AS [Table], COUNT(*) AS OrphanRows
FROM [dbo].[Notes] n
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = n.[CustomerId])
UNION ALL
SELECT 'ProducerDetails', COUNT(*)
FROM [dbo].[ProducerDetails] p
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = p.[CustomerId])
UNION ALL
SELECT 'ProducerPlantingIntentions', COUNT(*)
FROM [dbo].[ProducerPlantingIntentions] i
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = i.[CustomerId]);

-- A. Rows (top 200 per table)
SELECT TOP (200) 'Notes' AS [Table], n.*
FROM [dbo].[Notes] n
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = n.[CustomerId]);

SELECT TOP (200) 'ProducerDetails' AS [Table], p.*
FROM [dbo].[ProducerDetails] p
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = p.[CustomerId]);

SELECT TOP (200) 'ProducerPlantingIntentions' AS [Table], i.*
FROM [dbo].[ProducerPlantingIntentions] i
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Customer] c WHERE c.[CustomerId] = i.[CustomerId]);
