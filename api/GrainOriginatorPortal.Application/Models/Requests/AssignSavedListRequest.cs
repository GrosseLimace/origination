using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>A manager assigning a copy of a built list to one or more team members. The list content
/// mirrors <see cref="CreateSavedListRequest"/>; <see cref="TargetUserIds"/> are the recipients'
/// short UPNs. One independent saved-list copy is created per target.</summary>
public record AssignSavedListRequest
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

    [Required]
    [MinLength(1, ErrorMessage = "Select at least one team member to assign the list to.")]
    public required IReadOnlyList<string> TargetUserIds { get; init; }
}
