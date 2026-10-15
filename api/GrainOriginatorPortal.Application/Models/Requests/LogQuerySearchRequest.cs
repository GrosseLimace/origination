using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record LogQuerySearchRequest
{
    [Required]
    [StringLength(500)]
    public string SearchText { get; init; } = string.Empty;

    public int? MatchedQueryId { get; init; }
}
