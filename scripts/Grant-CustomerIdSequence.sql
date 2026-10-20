-- Grant the principal the App Service connects as the right to take ids from dbo.CustomerIdSequence.
--
-- Why: on the CTRM customer source (CustomerSync:Source = ctrm) the nightly sync and the
-- add-a-customer onboarding mint ids for producers that have no ODS surrogate id, with
-- NEXT VALUE FOR dbo.CustomerIdSequence. db_datawriter does NOT cover sequences, so without
-- this grant the first minting run fails with "The UPDATE permission was denied on the
-- object 'CustomerIdSequence'". The sequence itself is created by migration
-- 20261006150349_AddCustomerIdSequence, which the deploy workflow applies first.
--
-- WHO to grant: database access here is by Entra GROUP, not by the App Service's own name.
-- Checked on Dev 2026-10-20: there is no user named app-origination-dev-eus; the role members are
-- the external groups azrscosqld01-Origination-db_datareader / -db_datawriter / -db_ddladmin.
-- The App Service identity writes through the db_datawriter group, so grant to that group: anyone
-- who can already write customers may then also mint their ids, which is the same trust.
--
-- Run once per environment, connected to that environment's Origination database, as a
-- DB owner (SSMS, Active Directory auth). Idempotent: re-running is a no-op.
--
-- Set @principal per environment. Dev is verified; confirm QA and PROD with the role-member
-- query at the bottom before running there (the names follow the server, by convention):
--   Dev  : azrscosqld01-Origination-db_datawriter   (verified 2026-10-20)
--   QA   : azrscosqlq01-Origination-db_datawriter   (expected)
--   PROD : azrscosqlp01-Origination-db_datawriter   (expected)

DECLARE @principal sysname = N'azrscosqld01-Origination-db_datawriter';   -- <-- change per environment

IF OBJECT_ID(N'dbo.CustomerIdSequence', N'SO') IS NULL
    THROW 50000, N'dbo.CustomerIdSequence does not exist yet - apply migration 20261006150349_AddCustomerIdSequence first.', 1;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @principal)
    THROW 50001, N'That principal is not in this database. Run the role-member query below and use the db_datawriter member name.', 1;

DECLARE @sql nvarchar(max) = N'GRANT UPDATE ON OBJECT::dbo.CustomerIdSequence TO ' + QUOTENAME(@principal) + N';';
EXEC sp_executesql @sql;

-- Verify: expect one row, permission_name = UPDATE, state_desc = GRANT.
SELECT dp.name AS grantee, p.permission_name, p.state_desc
FROM sys.database_permissions p
JOIN sys.database_principals dp ON dp.principal_id = p.grantee_principal_id
WHERE p.major_id = OBJECT_ID(N'dbo.CustomerIdSequence')
  AND dp.name = @principal;

-- Who writes to this database (use the db_datawriter member as @principal):
-- SELECT m.name AS member, m.type_desc, r.name AS role
-- FROM sys.database_role_members rm
-- JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
-- JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id
-- WHERE r.name IN (N'db_owner', N'db_datawriter', N'db_datareader', N'db_ddladmin')
-- ORDER BY m.name, r.name;
