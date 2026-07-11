namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A tagged field boundary (USDA CLU / tax parcel / hand-drawn polygon) attached to a Customer
/// (producer) record. POC-only: stored in the separate <see cref="FieldTagDbContext"/> backed by
/// a local SQLite file, never in the shared Origination Azure SQL database — see
/// docs/poc/field-tagging/01-data-model.md.
///
/// No Customer navigation property / no FK constraint: this table lives in a different database
/// than dbo.Customer, so a nav/Include() is impossible. The service layer resolves customer
/// display data (if ever needed) through ICustomerRepository against ApplicationDbContext.
/// </summary>
public class CustomerFieldTag
{
    public int Id { get; set; }
    public long CustomerId { get; set; }

    /// <summary>One of "clu", "parcel", "drawn" — validated at the API layer, stored as plain text.</summary>
    public string SelectionMethod { get; set; } = string.Empty;

    /// <summary>GeoJSON Polygon/MultiPolygon geometry object (not a Feature), serialized as text.</summary>
    public string GeometryJson { get; set; } = string.Empty;

    /// <summary>Vendor/geodesic calculated acreage.</summary>
    public decimal? CalcAcres { get; set; }

    /// <summary>
    /// Dedup key: "clu:" + native MVT feature id, "parcel:" + vendor parcel_id, or "drawn:" +
    /// SHA-256 hex of the normalized drawn geometry. See 01-data-model.md for derivation.
    /// </summary>
    public string ExternalRef { get; set; } = string.Empty;

    /// <summary>CDL vintage actually used, e.g. "2024" (falls back to "2023").</summary>
    public string? CdlYear { get; set; }

    /// <summary>Serialized CDL crop-breakdown array, stored verbatim as the client sends it.</summary>
    public string? CdlSnapshotJson { get; set; }

    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    // Soft-delete trio — same convention as Note. A delete → re-tag of the same field re-inserts
    // a fresh row; the filtered unique index on (CustomerId, ExternalRef) only covers IsDeleted = 0.
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }
}
