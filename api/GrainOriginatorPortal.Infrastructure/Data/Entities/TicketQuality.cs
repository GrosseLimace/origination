namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Represents quality data for a ticket from the vw_TicketQuality view.
/// Used to join with Ticket to get quality measures like moisture percentage.
/// </summary>
public class TicketQuality
{
    public long TicketId { get; set; }
    public decimal? GradeFactorMoisturePercent { get; set; }
    public decimal? GradeFactorProteinPercent { get; set; }
    public decimal? GradeFactorTestWeightPercent { get; set; }
    public string? GradeCode { get; set; }
}
