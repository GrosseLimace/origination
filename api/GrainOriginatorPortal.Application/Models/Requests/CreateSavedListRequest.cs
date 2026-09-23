using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreateSavedListRequest
{
    [Required]
    [StringLength(100)]
    public required string Name { get; init; }

    [Required]
    [StringLength(500)]
    public required string Query { get; init; }

    [StringLength(500)]
    public string? TradeUnits { get; init; }

    [StringLength(4000)]
    public string? Filters { get; init; }

    public string? IncludedCustomerIds { get; init; }  // JSON array string
    public string? ExcludedCustomerIds { get; init; }  // JSON array string
}
