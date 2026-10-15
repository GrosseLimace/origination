using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Mobile.Contracts;

/// <summary>Schema <c>PlantingIntention</c> (card #647): crop, acres, year.</summary>
public sealed record PlantingIntentionDto
{
    public required int Id { get; init; }
    public required long CustomerId { get; init; }
    public required int PlantingYear { get; init; }
    public required string Crop { get; init; }

    /// <summary>Irrigated, Dryland or Double Crop; null when none was recorded.</summary>
    public string? Type { get; init; }
    public required int Acres { get; init; }
    public required string TradeUnit { get; init; }
    public DateTime? ModifiedAt { get; init; }
}

/// <summary>Schema <c>PlantingIntentionCreate</c>. Year-level granularity only.</summary>
public sealed record PlantingIntentionCreateRequest
{
    [Required]
    public required Guid ClientRequestId { get; init; }

    [Range(2000, 2100)]
    public required int PlantingYear { get; init; }

    /// <summary>Commodity code from <c>/reference/commodities</c>.</summary>
    [Required, MaxLength(20)]
    public required string Crop { get; init; }

    [Range(0, 10_000_000)]
    public required int Acres { get; init; }

    /// <summary>Irrigated, Dryland or Double Crop (the desktop's choices); absent or empty = none.</summary>
    [MaxLength(20)]
    public string? Type { get; init; }

    /// <summary>One of the caller's trade units; absent = the producer's first trade unit the caller is entitled to.</summary>
    [MaxLength(10)]
    public string? TradeUnit { get; init; }
}

/// <summary>Schema <c>PlantingIntentionUpdate</c>.</summary>
public sealed record PlantingIntentionUpdateRequest
{
    [Required]
    public required Guid ClientRequestId { get; init; }

    [MaxLength(20)]
    public string? Crop { get; init; }

    [Range(0, 10_000_000)]
    public required int Acres { get; init; }

    /// <summary>The crop year; absent keeps the intention's year (older clients did not send it).</summary>
    [Range(2000, 2100)]
    public int? PlantingYear { get; init; }

    /// <summary>Irrigated, Dryland or Double Crop; empty clears it; absent keeps the current type.</summary>
    [MaxLength(20)]
    public string? Type { get; init; }

    public DateTime? ExpectedModifiedAt { get; init; }
}
