namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// A single trade-unit membership for a producer, returned to the edit dialog so it can show the
/// trade units the producer appears on. <see cref="IsManual"/> tells the UI whether the assignment
/// is editable (manual — removable) or locked (sync-sourced, i.e. the nightly job added it because
/// the producer has a contract/ticket on that trade unit). <see cref="IsActive"/> distinguishes
/// current memberships (shown as chips) from ones the producer previously had but that were removed
/// (manual removal or a dormant sync-TU removal) — the dialog offers those as re-addable suggestions
/// so a removal can always be undone, even for a TU absent from the entitlements catalog.
/// </summary>
public class CustomerTradeUnitInfo
{
    public string TradeUnit { get; set; } = string.Empty;
    public bool IsManual { get; set; }

    // True for current memberships; false for ones that were removed (soft-deactivated). Defaults
    // true so any caller/serializer that predates this field keeps seeing active memberships.
    public bool IsActive { get; set; } = true;

    // True when the producer currently has OPEN activity in this trade unit — an open purchase
    // contract or an active unapplied ticket. The UI uses this only for LOCKED (IsManual=false)
    // memberships: a locked TU with HasOpenActivity=false is "dormant" and can be removed by the
    // user; a locked TU with open activity stays locked. (Manual TUs are removable regardless.)
    // Defaults true on the server when activity can't be determined, so we never wrongly offer
    // removal of a producer that might still be active.
    public bool HasOpenActivity { get; set; } = true;
}
