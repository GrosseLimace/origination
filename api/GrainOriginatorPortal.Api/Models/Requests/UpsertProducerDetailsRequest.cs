using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpsertProducerDetailsRequest
{
    public string? SourceCustomerId { get; init; }

    [Required]
    public required string CustomerName { get; init; }

    public decimal? TotalAcres { get; init; }
    public decimal? BinCapacity { get; init; }
    public string? PrimaryContact { get; init; }
    public string? Commodities { get; init; }
    public string? LinkedProducerIds { get; init; }
}
