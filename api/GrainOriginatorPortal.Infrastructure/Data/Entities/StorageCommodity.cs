namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Projection of "what commodities does a customer currently hold in active storage" —
/// one row per (customer, commodity) returned by the storage-commodity aggregate against
/// ctrm.vw_GNTA39D1. Keyless; used only via SqlQueryRaw to gate customer-storage (C-prefix)
/// unapplied tickets so a ticket drops off once its grain is priced out of storage.
/// </summary>
public class StorageCommodity
{
    /// <summary>CTRM CUSTOMER_ID (Scoular customer code), trimmed + upper-cased.</summary>
    public string CustomerCode { get; set; } = string.Empty;

    /// <summary>COMMODITY_CODE, trimmed + upper-cased — matched against the ticket's ProductCode.</summary>
    public string Commodity { get; set; } = string.Empty;
}
