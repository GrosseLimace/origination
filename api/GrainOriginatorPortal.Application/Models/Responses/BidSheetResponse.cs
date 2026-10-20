namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Wire shape for a bid sheet: its shared column layout, who it is shared with, and the locations on
/// it in row order with their bids. Entity-shaped (Decision 1).
/// </summary>
public record BidSheetResponse
{
    public int Id { get; init; }
    public string Name { get; init; } = string.Empty;

    /// <summary>Short UPN of the owner.</summary>
    public string OwnerUserId { get; init; } = string.Empty;

    /// <summary>
    /// True when the caller owns this sheet. Everyone on a sheet can edit its contents; only the
    /// owner can rename it, change who it is shared with, or delete it, and the client greys those
    /// three controls off this flag rather than re-deriving ownership from the UPN.
    /// </summary>
    public bool IsOwner { get; init; }

    public string? CropOrder { get; init; }
    public string? HiddenCrops { get; init; }
    public string? SelectedMonths { get; init; }
    public string? SelectedYears { get; init; }

    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }

    public List<BidSheetShareResponse> Shares { get; init; } = [];

    /// <summary>Locations on the sheet, already in row order.</summary>
    public List<BidSheetLocationResponse> Locations { get; init; } = [];
}

public record BidSheetShareResponse
{
    /// <summary>What <see cref="MemberId"/> means: person / trade-unit / trade-unit-group / recap-group.</summary>
    public string MemberType { get; init; } = string.Empty;

    /// <summary>Short UPN, trade-unit code, entitlements group id, or recap group id — per MemberType.</summary>
    public string MemberId { get; init; } = string.Empty;

    /// <summary>The person's short UPN, populated ONLY for a person share and empty for the other three.
    /// Retained so a caller written against the people-only shape reads nothing rather than mistaking a
    /// desk code for a user id; new code should read MemberType + MemberId.</summary>
    public string UserId { get; init; } = string.Empty;

    public string? Name { get; init; }
    public string SharedBy { get; init; } = string.Empty;
    public DateTime SharedAt { get; init; }
}
