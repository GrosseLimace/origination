using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Read-only ODS context used ONLY by the DP-contract reads. Inherits every mapping from
/// <see cref="OriginationDbContext"/> and differs solely in which connection string it binds to.
///
/// ── WHY THIS EXISTS (TEMPORARY — 2026-08-04) ─────────────────────────────────────────────────
/// <c>ctrm.vw_GNTA70D1</c> (and its base tables <c>ctrm.GNTA70D1</c> / <c>stg.GNTA70D1</c>) are
/// EMPTY in the Dev ODS, so the DP Contracts tab has nothing to show and cannot be verified there.
/// To let the feature be exercised against real data, DP reads are pointed at the PRODUCTION ODS via
/// the <c>ODSDpConnection</c> connection string. This is safe because every DP code path is strictly
/// read-only — there is no insert/update/delete anywhere in <c>DpContractRepository</c>.
///
/// ── HOW TO REVERT once Dev/QA get DP data ────────────────────────────────────────────────────
/// Remove the <c>ODSDpConnection</c> entry from the environment's appsettings file. Nothing else has
/// to change: the DI registration falls back to the normal <c>ODSConnection</c> whenever
/// <c>ODSDpConnection</c> is absent, so deleting one line restores standard per-environment
/// behavior. To retire this class entirely, point <c>DpContractRepository</c> back at
/// <see cref="OriginationDbContext"/>, drop the registration in <c>DependencyInjection</c>, and
/// delete this file.
///
/// ── CAVEAT while the override is active ──────────────────────────────────────────────────────
/// DP rows come from prod but producer identity still comes from the LOCAL app DB
/// (<c>dbo.Customer</c>), because the customer-code → CustomerId join happens in C# across two
/// databases. A prod producer with no matching <c>ScoularId</c> in the current environment's
/// <c>dbo.Customer</c> resolves to CustomerId 0 and is filtered out. That is the intended, safe
/// direction to fail — it never attributes a DP position to the wrong producer.
/// </summary>
public class DpOdsDbContext : OriginationDbContext
{
    public DpOdsDbContext(DbContextOptions<DpOdsDbContext> options)
        : base(options)
    {
    }
}
