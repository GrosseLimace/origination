using System.ComponentModel.DataAnnotations;

using GrainOriginatorPortal.Infrastructure.Data.Entities;

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
    /// <summary>
    /// person / trade-unit / trade-unit-group / recap-group. Optional, defaulting to "person", so a
    /// caller sending the old people-only shape still means what it used to.
    /// </summary>
    [StringLength(20)]
    public string? MemberType { get; init; }

    /// <summary>
    /// The id for <see cref="MemberType"/>: short UPN, trade-unit code, entitlements group id, or recap
    /// group id. Falls back to <see cref="UserId"/> when absent, for the same backward compatibility.
    /// </summary>
    [StringLength(256)]
    public string? MemberId { get; init; }

    /// <summary>Short UPN ("CEgr"), the form the entitlements catalog returns. The old people-only
    /// field: still accepted, and still the id when MemberId is not sent.</summary>
    [StringLength(256)]
    public string? UserId { get; init; }

    [StringLength(256)]
    public string? Name { get; init; }

    /// <summary>The id to store, whichever field the caller populated. Server-side so one rule covers
    /// both request shapes and the service never has to care which it got.</summary>
    public string ResolvedMemberId => (MemberId ?? UserId ?? string.Empty).Trim();

    /// <summary>The type to store, defaulting a request that names none to a person share.</summary>
    public string ResolvedMemberType =>
        string.IsNullOrWhiteSpace(MemberType) ? BidSheetShareTypes.Person : MemberType.Trim();
}

/// <summary>Adds one existing, company-wide location to a sheet.</summary>
public record AddBidSheetLocationRequest
{
    [Range(1, int.MaxValue)]
    public required int LocationId { get; init; }
}

/// <summary>
/// What one sheet calls a location. Renames it ON THIS SHEET ONLY -- the shared row keeps its canonical
/// name, because locations are company-wide and two sheets holding the same elevator must not overwrite
/// each other's label.
/// </summary>
public record BidSheetLocationNameRequest
{
    /// <summary>
    /// This sheet's name for the location. Null or blank CLEARS the override, so the row goes back to
    /// following the canonical name -- that is the only way back, which is why blank is accepted here
    /// rather than rejected as an empty name.
    /// </summary>
    [MaxLength(200)]
    public string? Name { get; init; }
}

/// <summary>
/// Locations to take OFF a sheet. Unlinking, not deleting: the locations are company-wide and other
/// sheets may hold them, so they and their bids survive untouched.
/// </summary>
public record BidSheetRemoveLocationsRequest
{
    [MaxLength(2000, ErrorMessage = "Too many locations in one removal.")]
    public List<int> LocationIds { get; init; } = [];
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
