using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpsertProducerDetailsRequest
{
    [StringLength(50)]
    public string? ScoularId { get; init; }

    [Required]
    [StringLength(200)]
    public required string CustomerName { get; init; }

    [Range(0, 10_000_000)]
    public decimal? TotalAcres { get; init; }

    [Range(0, 100_000_000)]
    public decimal? BinCapacity { get; init; }

    [StringLength(200)]
    public string? PrimaryContact { get; init; }

    [StringLength(500)]
    public string? Commodities { get; init; }

    [StringLength(1000)]
    public string? LinkedProducerIds { get; init; }
}
