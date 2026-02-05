namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a delivery ticket for grain received at a facility.
/// Maps to the Ticket table in the ODS database.
/// </summary>
public class Ticket
{
    // Primary key - maps to TicketId (bigint)
    public long Id { get; set; }

    // Foreign keys
    public long? ContractId { get; set; }
    public long? CustomerId { get; set; }
    public string FarmId { get; set; } = string.Empty;

    // Source identifiers
    public long? SourceTicketHeaderId { get; set; }
    public long? SourceTicketDetailId { get; set; }

    // Ticket identifiers
    public string? ProductCode { get; set; }
    public string? TicketPrefix { get; set; }
    public string TicketNumber { get; set; } = string.Empty;
    public string? TicketSuffix { get; set; }
    public string? CtrmContractNumber { get; set; }

    // Dates
    public DateTime? Date { get; set; } // Maps to TicketDate
    public DateTime? FinalSettledDate { get; set; }

    // Quantities (various types in ODS)
    public decimal? UnloadQuantity { get; set; }
    public decimal? LoadoutQuantity { get; set; }
    public decimal? AppliedDockQuantity { get; set; }
    public decimal? AppliedQuantity { get; set; }
    public int GrossWeight { get; set; }
    public int TareWeight { get; set; }
    public int NetWeight { get; set; }

    // Quality measures
    public decimal? Moisture { get; set; } // Maps to MoisturePercent
    public decimal? TestWeight { get; set; } // Maps to TestWeightPercent
    public decimal? ProteinPercent { get; set; }

    // Status
    public bool IsActive { get; set; }
}
