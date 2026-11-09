using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Models.Requests;

/// <summary>
/// One field's FD-CIC inputs. Crop, cover crop and tillage use the labels from
/// <c>GET api/fd-cic/{year}/options</c>; the service checks them against the year's version.
/// </summary>
public record FdCicScoreRequest
{
    [Required]
    [StringLength(20)]
    public required string Crop { get; init; }

    [Required]
    [StringLength(2, MinimumLength = 2)]
    public required string State { get; init; }

    [Required]
    [StringLength(100)]
    public required string County { get; init; }

    /// <summary>bu/ac. Leave empty for a projected score before harvest.</summary>
    [Range(0, 10000)]
    public double? ActualYield { get; init; }

    /// <summary>bu/ac; must be above 0.</summary>
    [Range(0, 10000)]
    public double ExpectedYield { get; init; }

    /// <summary>Total synthetic N, lb N/ac.</summary>
    [Range(0, 5000)]
    public double SyntheticN { get; init; }

    /// <summary>Share of synthetic N with a nitrification inhibitor, 0 to 1.</summary>
    [Range(0, 1)]
    public double NiFraction { get; init; }

    [Required]
    [StringLength(50)]
    public required string CoverCrop { get; init; }

    [Required]
    [StringLength(50)]
    public required string Tillage { get; init; }

    [MaxLength(3)]
    public List<FdCicManureRequest> Manure { get; init; } = [];
}

public record FdCicManureRequest
{
    /// <summary>tons/ac (solid) or 1,000 gal/ac (liquid).</summary>
    [Range(0, 100000)]
    public double Amount { get; init; }

    /// <summary>lb N per ton or per 1,000 gal.</summary>
    [Range(0, 10000)]
    public double NContent { get; init; }
}
