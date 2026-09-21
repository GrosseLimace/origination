-- =====================================================================
-- Backfill EF Core __EFMigrationsHistory
-- =====================================================================
-- Run ONCE per environment (Dev, QA, Prod) BEFORE the first auto-run of
-- `dotnet ef database update` from the deploy workflow.
--
-- Why: this team has historically applied migrations manually via SSMS.
-- Some old migrations (AddCustomerForeignKeys, AddUserPreferences,
-- ReplaceBidSheetTables) are NOT idempotent — if EF doesn't see them
-- recorded in __EFMigrationsHistory it will try to re-run them and crash.
-- This script records the pre-May-2026 migrations that were applied by hand, idempotently
-- (NOT EXISTS guards), so EF treats them as already applied. Three of the ids
-- (AddCustomerForeignKeys, ReplaceBidSheetTables, AddNoteSoftDelete) were later squashed
-- and no longer exist as .cs files; they stay here so environments that DID apply them
-- keep a consistent history row. Re-running this script is a no-op.
--
-- Run against: Origination database on azrscosqld01 (Dev),
--              azrscosqlq01 (QA), and azrscosqlp01 (Prod).
-- =====================================================================

-- 1. Show current state (run before to see what's missing)
SELECT MigrationId, ProductVersion FROM dbo.__EFMigrationsHistory ORDER BY MigrationId;

-- 2. Backfill any missing migration rows. Each guarded so re-runs are safe.
DECLARE @v nvarchar(32) = '10.0.0';

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = '20260203213531_AddCustomerForeignKeys')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20260203213531_AddCustomerForeignKeys', @v);

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = '20260310202402_AddESignEnrollment')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20260310202402_AddESignEnrollment', @v);

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = '20260311165130_ReshapeAppTables')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20260311165130_ReshapeAppTables', @v);

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = '20260311180519_AddNoteCustomerCode')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20260311180519_AddNoteCustomerCode', @v);

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = '20260313170311_AddUserPreferences')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20260313170311_AddUserPreferences', @v);

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = '20260324000000_ReplaceBidSheetTables')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20260324000000_ReplaceBidSheetTables', @v);

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = '20260428200000_AddNoteSoftDelete')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20260428200000_AddNoteSoftDelete', @v);

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = '20260430164629_RenameSourceCustomerIdToScoularId')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20260430164629_RenameSourceCustomerIdToScoularId', @v);

-- 3. Verify all 8 migrations are present (run after to confirm)
SELECT MigrationId, ProductVersion FROM dbo.__EFMigrationsHistory ORDER BY MigrationId;

-- Expected output: 8 rows, in order:
--   20260203213531_AddCustomerForeignKeys
--   20260310202402_AddESignEnrollment
--   20260311165130_ReshapeAppTables
--   20260311180519_AddNoteCustomerCode
--   20260313170311_AddUserPreferences
--   20260324000000_ReplaceBidSheetTables
--   20260428200000_AddNoteSoftDelete
--   20260430164629_RenameSourceCustomerIdToScoularId
