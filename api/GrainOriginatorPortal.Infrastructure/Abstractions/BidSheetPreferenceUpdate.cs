namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// Layer-neutral input for a bid-sheet preference write. The Api request DTO is mapped onto this so
/// the repository never references the Api layer.
///
/// <para>
/// <b>Two different update rules live here, and the split is deliberate.</b>
/// <list type="bullet">
///   <item><description>
///     <see cref="CropCode"/>, <see cref="Month"/> and <see cref="CropYear"/> -- the map panel's
///     single-value selection -- are assigned <b>unconditionally</b>, null included. Every caller
///     re-sends the current panel state on every write, so a null here genuinely means "no
///     selection", not "unspecified".
///   </description></item>
///   <item><description>
///     Every other field is <b>"null leaves the stored value alone"</b>. Callers send only the one
///     they are changing. To clear one, send an empty JSON array, not null.
///   </description></item>
/// </list>
/// </para>
///
/// <para>
/// The owning user is NOT a field here -- it is a separate parameter taken from the request context,
/// so a request body can never redirect a write at another user's row.
/// </para>
/// </summary>
public record BidSheetPreferenceUpdate
{
    /// <summary>Always the global key today; retained because the unique index is (UserId, TradeUnitKey).</summary>
    public string TradeUnitKey { get; init; } = string.Empty;

    // ---- Assigned unconditionally (the map panel's selection) ------------------------------------
    public string? CropCode { get; init; }
    public int? Month { get; init; }
    public int? CropYear { get; init; }

    // ---- Null leaves the stored value alone ------------------------------------------------------

    public string? CropOrder { get; init; }

    public string? HiddenCrops { get; init; }

    public string? SelectedMonths { get; init; }

    public string? SelectedYears { get; init; }

    public string? PrintLayout { get; init; }
    public string? PriceMode { get; init; }
    public string? SelectedBidSheetIds { get; init; }
}
