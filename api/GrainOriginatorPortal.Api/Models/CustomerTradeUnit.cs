namespace GrainOriginatorPortal.Api.Models;

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

    // Navigation property — not always loaded; explicit Include() required.
    public Customer? Customer { get; set; }
}
