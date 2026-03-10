using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class UpsertProducerDetailsRequest
{
    public string? SourceCustomerId { get; set; }

    [Required]
    public string CustomerName { get; set; } = string.Empty;

    public decimal? TotalAcres { get; set; }
    public decimal? BinCapacity { get; set; }
    public string? PrimaryContact { get; set; }
    public string? Commodities { get; set; }
    public string? LinkedProducerIds { get; set; }
}
