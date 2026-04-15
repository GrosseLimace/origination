namespace GrainOriginatorPortal.Api.Models;

public class FeatureUsageDaily
{
    public long Id { get; set; }
    public DateOnly ActivityDate { get; set; }
    public string FeatureCode { get; set; } = string.Empty;
    public string SubFeatureCode { get; set; } = "__total__";
    public int SessionCount { get; set; }
    public int UniqueUsers { get; set; }
    public int RequestCount { get; set; }
    public int ClickCount { get; set; }
}
