namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class WeeklyLoginAggregate
{
    public long Id { get; set; }
    public DateOnly WeekStartDate { get; set; }
    public string UserId { get; set; } = string.Empty;
    public int LoginCount { get; set; }
    public int SessionCount { get; set; }
    public int TotalSessionMin { get; set; }
}
