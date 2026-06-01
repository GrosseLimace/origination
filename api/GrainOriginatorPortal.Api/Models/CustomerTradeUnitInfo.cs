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
}
