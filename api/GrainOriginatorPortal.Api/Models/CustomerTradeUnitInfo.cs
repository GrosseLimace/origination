namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// A single active trade-unit membership for a producer, returned to the edit dialog so it
/// can show the trade units the producer appears on. <see cref="IsManual"/> tells the UI
/// whether the assignment is editable (manual — removable) or locked (sync-sourced, i.e. the
/// nightly job added it because the producer has a contract/ticket on that trade unit).
/// </summary>
public class CustomerTradeUnitInfo
{
    public string TradeUnit { get; set; } = string.Empty;
    public bool IsManual { get; set; }

    // True when the producer currently has OPEN activity in this trade unit — an open purchase
    // contract or an active unapplied ticket. The UI uses this only for LOCKED (IsManual=false)
    // memberships: a locked TU with HasOpenActivity=false is "dormant" and can be removed by the
    // user; a locked TU with open activity stays locked. (Manual TUs are removable regardless.)
    // Defaults true on the server when activity can't be determined, so we never wrongly offer
    // removal of a producer that might still be active.
    public bool HasOpenActivity { get; set; } = true;
}
