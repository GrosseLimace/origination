namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a delivery ticket. Entity-shaped (Decision 1), including the entity's
/// computed ParsedDate and IsApplied so the SPA contract is unchanged.</summary>
public record TicketResponse
{
    public long Id { get; init; }
    public long? ContractId { get; init; }
    public long? CustomerId { get; init; }
    public string FarmId { get; init; } = string.Empty;
    public long? SourceTicketHeaderId { get; init; }
    public long? SourceTicketDetailId { get; init; }
    public string? CustomerCode { get; init; }
    public string? ProductCode { get; init; }
    public string? TicketPrefix { get; init; }
    public string TicketNumber { get; init; } = string.Empty;
    public string? TicketSuffix { get; init; }
    public string? ShipmentTicketNumber { get; init; }
    public string? CtrmContractNumber { get; init; }
    public string? OrganizationCode { get; init; }
    public string? ElevatorCode { get; init; }
    public string? UnloadOrganizationCode { get; init; }
    public string? ElevatorCity { get; init; }
    public string? ElevatorState { get; init; }
    public string? Date { get; init; }
    public DateTime? FinalSettledDate { get; init; }
    public DateTime? ParsedDate { get; init; }
    public decimal? UnloadQuantity { get; init; }
    public decimal? LoadoutQuantity { get; init; }
    public long? AppliedDockQuantity { get; init; }
    public decimal? AppliedQuantity { get; init; }
    public int GrossWeight { get; init; }
    public int TareWeight { get; init; }
    public int NetWeight { get; init; }
    public decimal? Moisture { get; init; }
    public decimal? TestWeight { get; init; }
    public decimal? ProteinPercent { get; init; }
    public string? GradeCode { get; init; }
    public string? TicketType { get; init; }
    public bool IsApplied { get; init; }
    public string? TicketStatusDescription { get; init; }
    public bool IsActive { get; init; }
}
