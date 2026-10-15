using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Moves every one of a producer's planting intentions from one trade unit to another.
/// Used when a producer is unassigned from a trade unit: the acres are still being planted, so the
/// originator is asked where they should now count rather than leaving them stranded.</summary>
public record RetagPlantingIntentionsRequest
{
    [Required]
    public required long CustomerId { get; init; }

    /// <summary>The trade unit being vacated. Not validated against current memberships — by the
    /// time this runs the producer has usually just been removed from it.</summary>
    [Required]
    [StringLength(100)]
    public required string FromTradeUnit { get; init; }

    /// <summary>Where the rows should count instead. Must be one of the producer's active trade units.</summary>
    [Required]
    [StringLength(100)]
    public required string ToTradeUnit { get; init; }
}
