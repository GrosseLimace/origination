# EF Core Migrations — Auto-apply on Deploy

The deploy workflows (`deploy-dev.yml`, `deploy-qa.yml`, `deploy-prod.yml`) now run
`dotnet ef database update` against the target Origination database before deploying
the new app code. This replaces the previous manual SSMS step we had to do every release.

## How it works

1. Workflow logs into Azure with OIDC (existing step).
2. Workflow restores the local `dotnet-ef` tool (pinned version in `.config/dotnet-tools.json`).
3. Workflow runs `dotnet ef database update --context ApplicationDbContext`.
4. EF reads the connection string from `appsettings.{Env}.json` and connects via
   `Active Directory Default` auth — the OIDC identity that just logged in.
5. EF reads `__EFMigrationsHistory` and applies any migrations not yet recorded.
6. App Service deploy proceeds only if migrations succeed.

## One-time prerequisites per environment

Before the first auto-run in QA and Prod (Dev was already aligned manually):

### A. Grant the GitHub Actions OIDC identity SQL access

The OIDC service principal (the one used by `azure/login@v2`) needs to be added as a
SQL user with permission to read schema, run `ALTER TABLE`, and update history. Have
a DB owner run this in SSMS connected to the target Origination DB:

```sql
-- Replace <oidc-app-name> with the GitHub Actions service principal display name.
-- (The same one in AZURE_CLIENT_ID secret — your DBA / Azure admin can look it up.)
CREATE USER [<oidc-app-name>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_ddladmin    ADD MEMBER [<oidc-app-name>];
ALTER ROLE db_datareader  ADD MEMBER [<oidc-app-name>];
ALTER ROLE db_datawriter  ADD MEMBER [<oidc-app-name>];
```

### B. Backfill `__EFMigrationsHistory` so old migrations aren't re-run

Some older migrations are NOT idempotent. If they aren't recorded in the history
table, EF would try to re-apply them and crash. Run:

```
scripts/backfill-migration-history.sql
```

against each Origination DB (Dev / QA / Prod). The script is idempotent — re-running
is a no-op.

## Troubleshooting

- **Workflow fails with "Login failed for user '<token-identified principal>'"** →
  Step A wasn't done. Have the DBA add the OIDC identity as a SQL user.
- **Workflow fails with "There is already an object named 'X' in the database"** →
  Step B wasn't done, or a new non-idempotent migration was added. Backfill or
  rewrite the migration with `IF NOT EXISTS` guards.
- **Workflow fails with "Connection timeout"** → SQL firewall blocking the GHA
  runner. The Azure SQL firewall rules need to allow the runner's IP (or use a
  managed identity with VNet integration).

## Verification after first run

```sql
SELECT TOP 10 MigrationId, ProductVersion
FROM dbo.__EFMigrationsHistory
ORDER BY MigrationId DESC;
```

The most recent MigrationId should match the latest file in
`api/GrainOriginatorPortal.Api/Data/Migrations/`.
