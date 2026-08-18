using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Read-only ODS context used ONLY by the DP-contract reads. Inherits every mapping from
/// <see cref="OriginationDbContext"/> and differs solely in which connection string it binds to.
///
/// ── CURRENT BEHAVIOR (as of 2026-08-13) ──────────────────────────────────────────────────────
/// <c>ODSDpConnection</c> is NOT set in any environment, so this context binds to the ordinary
/// <c>ODSConnection</c> and every environment reads its OWN ODS: local/Dev → Dev ODS, QA → QA ODS,
/// Prod → Prod ODS. DP behaves like every other ODS-backed feature and no sign-in prompt appears.
///
/// Consequence, and it is a data gap rather than a config one: <c>ctrm.vw_GNTA70D1</c> is still
/// EMPTY in the Dev and QA ODS, so the DP Contracts tab renders its empty state there. When ODS
/// loads that view the tab populates on its own — no code or config change required.
///
/// ── THE OVERRIDE (opt-in, local only) ────────────────────────────────────────────────────────
/// Setting <c>ODSDpConnection</c> points DP reads — and only DP reads — at a different ODS. It is
/// commented out in <c>appsettings.Development.json</c> for validating displayed values against real
/// prod data, and is safe to enable there because every DP path is strictly read-only:
/// <c>DpContractRepository</c> contains no insert, update, or delete. Do NOT set it in a deployed
/// environment; that would also require granting the App Service managed identity read access to
/// another environment's ODS, which is deliberately not in place.
///
/// ── CAVEAT that applies ONLY while the override is enabled ───────────────────────────────────
/// DP rows would come from prod while producer identity still comes from the LOCAL app DB
/// (<c>dbo.Customer</c>), because the customer-code → CustomerId join happens in C# across two
/// databases. A prod producer with no matching <c>ScoularId</c> in the current environment's
/// <c>dbo.Customer</c> resolves to CustomerId 0 and is filtered out. That is the intended, safe
/// direction to fail — it never attributes a DP position to the wrong producer.
///
/// ── TO RETIRE THIS CLASS ENTIRELY ────────────────────────────────────────────────────────────
/// Point <c>DpContractRepository</c> back at <see cref="OriginationDbContext"/>, drop the
/// registration in <c>DependencyInjection</c>, delete this file, and remove the
/// <c>protected OriginationDbContext(DbContextOptions)</c> constructor added for it. Kept for now
/// purely as the validation escape hatch described above.
/// </summary>
public class DpOdsDbContext : OriginationDbContext
{
    public DpOdsDbContext(DbContextOptions<DpOdsDbContext> options)
        : base(options)
    {
    }
}
