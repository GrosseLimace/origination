namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>Outcome of an AssignTradeUnitsAsync call, so the controller can map to the right HTTP status.</summary>
public enum AssignTradeUnitsResult
{
    Ok,
    NoCodes,
    CustomerNotFound,
}

/// <summary>
/// What AssignTradeUnitsAsync did and to which customer id. <see cref="CustomerId"/> is the id the
/// trade units were written to: the requested id, or — when <see cref="Adopted"/> — an existing
/// dbo.Customer row that already holds the producer's ScoularId (e.g. a CTRM-minted id), so the
/// controller returns that customer instead of 404ing on the requested one.
/// </summary>
public sealed record AssignTradeUnitsOutcome(AssignTradeUnitsResult Result, long CustomerId, bool Adopted)
{
    public static AssignTradeUnitsOutcome Ok(long customerId, bool adopted = false) => new(AssignTradeUnitsResult.Ok, customerId, adopted);
    public static AssignTradeUnitsOutcome NoCodes(long requested) => new(AssignTradeUnitsResult.NoCodes, requested, false);
    public static AssignTradeUnitsOutcome CustomerNotFound(long requested) => new(AssignTradeUnitsResult.CustomerNotFound, requested, false);
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
