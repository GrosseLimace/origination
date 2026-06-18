namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>Outcome of an AssignTradeUnitsAsync call, so the controller can map to the right HTTP status.</summary>
public enum AssignTradeUnitsResult
{
    Ok,
    NoCodes,
    CustomerNotFound,
}

/// <summary>Outcome of a DeactivateDormantTradeUnitAsync call, so the controller can map to the right HTTP status.</summary>
public enum DeactivateTradeUnitResult
{
    Ok,           // membership removed (UserDeactivated)
    NotFound,     // no active membership for this (customer, trade unit)
    StillActive,  // refused: the producer still has an open contract / unapplied ticket in that TU
}

/// <summary>
/// Layer-neutral projection of a producer's trade-unit membership. The Api layer maps this onto its
/// CustomerTradeUnitInfo response DTO. <see cref="HasOpenActivity"/> defaults true so a membership whose
/// activity can't be determined is treated as locked (never wrongly offered for removal).
/// <see cref="IsActive"/> distinguishes current memberships from previously-removed ones (the dialog
/// offers the removed ones as re-addable suggestions); defaults true for back-compat.
/// </summary>
public record CustomerTradeUnitMembership
{
    public string TradeUnit { get; set; } = string.Empty;
    public bool IsManual { get; set; }
    public bool HasOpenActivity { get; set; } = true;
    public bool IsActive { get; set; } = true;
}
