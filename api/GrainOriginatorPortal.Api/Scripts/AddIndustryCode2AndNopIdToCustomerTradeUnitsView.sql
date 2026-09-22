-- Add IndustryCode2 (the organic 'OR' code) and NopIdNumber to
-- originations.vw_CustomerTradeUnits so the customer sync can carry them onto dbo.Customer.
--
-- Both columns already exist on base.Customer as nvarchar(100) NULL; this only projects them.
-- Additive and safe: they are per-customer attributes, so they cannot change the row count of
-- either SELECT DISTINCT block or their UNION.
--
-- RUN ORDER: this view change must land in an environment BEFORE the application code that
-- declares the columns is deployed there. CustomerTradeUnitView is mapped with ToView, so EF
-- selects every declared property by name and a missing column fails the whole query -- which
-- stops the nightly customer sync. Dev applied 2026-09-21; QA and PROD still owed.
--
-- NOTE: NopIdNumber holds the literal '0' as a placeholder on ~1,525 rows. The sync normalises
-- that to NULL on the way in (CustomerSyncService.ApplyAttributes); do not treat '0' as a NOPID.

ALTER VIEW [originations].[vw_CustomerTradeUnits]
AS
-- Customers linked via active contracts
SELECT DISTINCT
    c.CustomerId,
    c.CustomerName,
    c.SourceCustomerId,
    c.MerchandisingPhone,
    c.MerchandisingEmail,
    c.ExtendedPrimaryPhone,
    c.SupplementalEmail,
    c.MerchandisingCity,
    c.MerchandisingStateProvince,
    c.MerchandisingAddressLine1,
    c.MerchandisingPostalCode,
    c.ExtendedAddressLine1,
    c.ExtendedAddressLine2,
    c.ExtendedAddressLine3,
    c.ExtendedAddressLine4,
    c.ExtendedCity,
    c.ExtendedStateProvince,
    c.ExtendedPostalCode,
    c.ExtendedCountry,
    c.IndustryCode1,
    c.IndustryCode2,
    c.NopIdNumber,
    c.IsActive,
    c.EffectiveStartDate,
    c.EffectiveEndDate,
    con.TradeUnit
FROM base.Customer c
INNER JOIN base.Contract con ON con.CtrmCustomerId = c.SourceCustomerId
WHERE c.IsActive    = 1
  AND c.IndustryCode1 = 'PR'
  AND c.CustomerName NOT LIKE '%DUP%'
  AND c.CustomerName NOT LIKE '%DO NOT USE%'
  AND LEFT(c.CustomerName, 1) NOT IN ('*', '$')
  AND con.IsActive  = 1
  AND con.TradeUnit IS NOT NULL

UNION

-- Customers linked via active tickets
SELECT DISTINCT
    c.CustomerId,
    c.CustomerName,
    c.SourceCustomerId,
    c.MerchandisingPhone,
    c.MerchandisingEmail,
    c.ExtendedPrimaryPhone,
    c.SupplementalEmail,
    c.MerchandisingCity,
    c.MerchandisingStateProvince,
    c.MerchandisingAddressLine1,
    c.MerchandisingPostalCode,
    c.ExtendedAddressLine1,
    c.ExtendedAddressLine2,
    c.ExtendedAddressLine3,
    c.ExtendedAddressLine4,
    c.ExtendedCity,
    c.ExtendedStateProvince,
    c.ExtendedPostalCode,
    c.ExtendedCountry,
    c.IndustryCode1,
    c.IndustryCode2,
    c.NopIdNumber,
    c.IsActive,
    c.EffectiveStartDate,
    c.EffectiveEndDate,
    t.OrganizationCode AS TradeUnit
FROM base.Customer c
INNER JOIN base.Ticket t ON t.CustomerId = c.CustomerId
WHERE c.IsActive    = 1
  AND c.IndustryCode1 = 'PR'
  AND c.CustomerName NOT LIKE '%DUP%'
  AND c.CustomerName NOT LIKE '%DO NOT USE%'
  AND LEFT(c.CustomerName, 1) NOT IN ('*', '$')
  AND t.ETL_Delete_Datetime IS NULL   -- was: t.IsActive = 1 AND t.IsDeleted = 0
  AND t.OrganizationCode IS NOT NULL;
