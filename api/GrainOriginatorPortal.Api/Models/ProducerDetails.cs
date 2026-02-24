namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Stores user-entered customer/producer details that don't come from the ODS.
/// Stored in Origination.dbo.ProducerDetails table (application-managed data).
/// One record per customer — upserted on save.
/// </summary>
public class ProducerDetails
{
    public long Id { get; set; }
    public long CustomerId { get; set; }
    public string? SourceCustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public decimal? TotalAcres { get; set; }
    public decimal? BinCapacity { get; set; }
    public string? PrimaryContact { get; set; }
    public string? Commodities { get; set; } // Comma-separated list (e.g. "Corn,Soybeans,Wheat")
    public string? LinkedProducerIds { get; set; } // Comma-separated customer IDs
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedOn { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedOn { get; set; }
}
