using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Create or rename a sheet. A sheet is a named working set of locations that replaced the
/// trade unit as the thing deciding what the Bid Sheet screen shows.</summary>
public record BidSheetRequest
{
    [Required]
    [StringLength(200, MinimumLength = 1)]
    public required string Name { get; init; }
}

/// <summary>Replaces the whole share list. Sending an empty list unshares the sheet.</summary>
public record BidSheetSharesRequest
{
    // Capped for the same reason the recap group is: the list is replaced wholesale on every save, so
    // an unbounded body is an unbounded DELETE + INSERT.
    [MaxLength(200, ErrorMessage = "A bid sheet cannot be shared with more than 200 people.")]
    public List<BidSheetShareRequest> Members { get; init; } = [];
}

public record BidSheetShareRequest
{
    /// <summary>Short UPN ("CEgr"), the form the entitlements catalog returns.</summary>
    [Required]
    [StringLength(256)]
    public required string UserId { get; init; }

    [StringLength(256)]
    public string? Name { get; init; }
}

/// <summary>Adds one existing, company-wide location to a sheet.</summary>
public record AddBidSheetLocationRequest
{
    [Range(1, int.MaxValue)]
    public required int LocationId { get; init; }
}

/// <summary>The row order for a sheet, replacing the per-user LocationOrder JSON.</summary>
public record BidSheetLocationOrderRequest
{
    [MaxLength(2000, ErrorMessage = "Too many locations in one order update.")]
    public List<int> LocationIds { get; init; } = [];
}

/// <summary>
/// The shared column layout. Every field is optional and a null one is left untouched, because the
/// screen saves crop order, hidden crops, months and years on four separate interactions.
/// </summary>
public record BidSheetLayoutRequest
{
    /// <summary>JSON array of crop codes in display order, e.g. ["HRWW","YC"].</summary>
    [StringLength(4000)]
    public string? CropOrder { get; init; }

    /// <summary>JSON array of hidden crop codes.</summary>
    [StringLength(4000)]
    public string? HiddenCrops { get; init; }

    /// <summary>JSON array of months, where 0 is the Year column.</summary>
    [StringLength(1000)]
    public string? SelectedMonths { get; init; }

    /// <summary>JSON array of crop years.</summary>
    [StringLength(1000)]
    public string? SelectedYears { get; init; }
}
