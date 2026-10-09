using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Stores user-entered customer/producer details that don't come from the ODS.
/// Stored in Origination.dbo.ProducerDetails table (application-managed data).
/// One record per customer — upserted on save.
/// </summary>
public class ProducerDetails
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string? ScoularId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public decimal? TotalAcres { get; set; }
    // BinCapacity was dropped 2026-10-09: storage capacity lives on each bin site (ProducerBinSite.Capacity);
    // the values moved onto a "Bin 1" site (migration MoveBinCapacityAndGrainOntoBinSites).
    public string? PrimaryContact { get; set; }
    public string? PrimaryPhone { get; set; } // user-entered override for the pulled-in phone number
    public string? Commodities { get; set; } // Comma-separated list (e.g. "Corn,Soybeans,Wheat")
    public string? LinkedProducerIds { get; set; } // Comma-separated customer IDs

    // Per-commodity grain-on-farm breakdown. NOT a stored column — composed by the repository from
    // dbo.ProducerGrainOnFarm on read, and rebuilt from the request on upsert (EF .Ignore()s it).
    public List<GrainOnFarmEntry> GrainOnFarm { get; set; } = new();

    // User-entered contacts (name/label/phone/email, one flagged primary). NOT a stored column —
    // composed from dbo.ProducerContact on read, rebuilt on upsert (EF .Ignore()s it). The primary
    // row is dual-written into PrimaryContact/PrimaryPhone above for search/lookup compatibility.
    public List<ProducerContactEntry> Contacts { get; set; } = new();

    // User-entered bin sites (optional name + lat/long). NOT a stored column — composed from
    // dbo.ProducerBinSite on read, rebuilt on upsert (EF .Ignore()s it).
    public List<ProducerBinSiteEntry> BinSites { get; set; } = new();
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    // Navigation property — FK to dbo.Customer. Populated via Include() so the
    // service layer can copy CustomerName / ScoularId onto the DTO without those
    // columns being stored on the ProducerDetails table.
    // [JsonIgnore] keeps the nested Customer out of API responses.
    [JsonIgnore]
    public Customer? Customer { get; set; }
}
