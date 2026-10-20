-- Grant the App Service managed identity the right to take ids from dbo.CustomerIdSequence.
--
-- Why: on the CTRM customer source (CustomerSync:Source = ctrm) the nightly sync and the
-- add-a-customer onboarding mint ids for producers that have no ODS surrogate id, with
-- NEXT VALUE FOR dbo.CustomerIdSequence. db_datawriter does NOT cover sequences, so without
-- this grant the first minting run fails with "The UPDATE permission was denied on the
-- object 'CustomerIdSequence'". The sequence itself is created by migration
-- 20261006150349_AddCustomerIdSequence, which the deploy workflow applies first.
--
-- Run once per environment, connected to that environment's Origination database, as a
-- DB owner (SSMS, Active Directory auth). Idempotent: re-running is a no-op.
--
-- Replace the identity name per environment (the App Service's system-assigned identity,
-- the same user the app already connects as):
--   Dev  : app-origination-dev-eus
--   QA   : app-origination-qa-eus
--   PROD : app-origination-eus

DECLARE @identity sysname = N'app-origination-dev-eus';   -- <-- change per environment

IF OBJECT_ID(N'dbo.CustomerIdSequence', N'SO') IS NULL
    THROW 50000, N'dbo.CustomerIdSequence does not exist yet - apply migration 20261006150349_AddCustomerIdSequence first.', 1;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @identity)
    THROW 50001, N'The identity is not a user in this database; the app could not be connecting as it. Check the name.', 1;

DECLARE @sql nvarchar(max) = N'GRANT UPDATE ON OBJECT::dbo.CustomerIdSequence TO ' + QUOTENAME(@identity) + N';';
EXEC sp_executesql @sql;

-- Verify: expect one row, permission_name = UPDATE, state_desc = GRANT.
SELECT dp.name AS grantee, p.permission_name, p.state_desc
FROM sys.database_permissions p
JOIN sys.database_principals dp ON dp.principal_id = p.grantee_principal_id
WHERE p.major_id = OBJECT_ID(N'dbo.CustomerIdSequence')
  AND dp.name = @identity;
