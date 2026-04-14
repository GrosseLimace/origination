namespace GrainOriginatorPortal.Api.Models;

public class QuerySearchLog
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string SearchText { get; set; } = string.Empty;
    public int? MatchedQueryId { get; set; }
    public DateTime Timestamp { get; set; }
}
