namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// App-DB join table — one row per (customer, trade unit) pair. Materializes the
/// many-to-many membership from ODS originations.vw_CustomerTradeUnits so the app DB
/// can scope customer queries by trade unit without cross-database joins.
///
/// TradeUnit is the CTRM organization code (e.g. "2057") and is a soft reference to
/// the shared CTRM vocabulary — no FK to a local catalog (the app DB doesn't own one;
/// see Entitlements DB vw_UserTradeUnitAccess for the authoritative TU/group catalog).
///
/// Not to be confused with <see cref="CustomerTradeUnitView"/>, the read-only projection
/// of the ODS source view that drives the sync into this table.
/// </summary>
public class CustomerTradeUnit
{
    // Surrogate identity — int is sufficient (max ~2.1B rows; this table is at most
    // single-digit millions even at full scale). CustomerId stays long/bigint because
    // it mirrors the ODS-sourced Customer.Id.
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string TradeUnit { get; set; } = string.Empty;
    public bool IsActive { get; set; }

    // True when a user assigned this trade unit manually via the app rather than the
    // nightly sync deriving it from a contract/ticket. The sync's soft-delete pass skips
    // IsManual rows so manual assignments aren't deactivated when absent from the ODS view.
    public bool IsManual { get; set; }

    // True when a user explicitly removed a SYNC-SOURCED (IsManual=false) membership while the
    // producer was "dormant" in that TU — i.e. had no open purchase contract and no unapplied
    // ticket there. Such a row is IsManual=false, IsActive=false, UserDeactivated=true.
    //
    // Why a separate flag (vs reusing IsManual/IsActive): the producer is usually STILL returned
    // by the ODS view (it keeps the pair even after contracts close), so the nightly sync would
    // otherwise re-activate the row every run. This flag tells the sync to RESPECT the removal —
    // the upsert pass leaves UserDeactivated rows alone, and a dedicated bring-back pass clears
    // the flag + re-locks the row only once the producer has open activity in that TU again.
    //
    // ADDITIVE + SAFE: defaults to false, so every existing row is unaffected and all current
    // behavior is unchanged until a user performs an explicit dormant removal. To roll back the
    // feature, revert the branch; leaving this unused column in the DB is harmless.
    public bool UserDeactivated { get; set; }

    // Audit columns — match the convention used across the app's writable tables (Notes,
    // ProducerDetails, Dashboard*, etc.). Authorship distinguishes machine vs. human writes:
    // the nightly CustomerSync stamps "system"; manual onboarding / dormant-removal stamp the
    // acting user's UPN. CreatedAt/CreatedBy are set on insert; ModifiedAt/ModifiedBy on every
    // subsequent change. (Existing rows were backfilled when the columns were added.)
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }

    // Navigation property — not always loaded; explicit Include() required.
    public Customer? Customer { get; set; }
}
