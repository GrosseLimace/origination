namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One row per BarChart ingest call we receive, successful or not.
///
/// Exists for one business reason: the vendor contract caps usage at 250,000 API calls per month on a
/// key shared by every environment, and failed calls count against it too. Since the vendor calls
/// themselves happen in the integration side's pipeline, this table meters what reaches <em>us</em> —
/// roughly one row per vendor call — which makes it a close proxy and a cross-check against their own
/// pipeline monitoring. <c>dbo.vw_BarchartMonthlyApiUsage</c> aggregates it.
/// </summary>
public class BarchartApiCallAudit
{
    public long ApiCallId { get; set; }

    public DateTime CalledAtUtc { get; set; }

    /// <summary>Which ingest operation, e.g. <c>ingest/quotes</c>.</summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>
    /// Sanitized description of what was requested (batch number, symbol count, snapshot date).
    /// MUST NOT contain the vendor API key, a bearer token, or the payload itself.
    /// </summary>
    public string? QueryParams { get; set; }

    public int? HttpStatus { get; set; }

    public bool Success { get; set; }

    /// <summary>Rows the call landed (instruments loaded, quotes upserted, bid cells written).</summary>
    public int? RowsAffected { get; set; }

    public int? DurationMs { get; set; }

    /// <summary>Failure detail for operators. Never contains payload contents.</summary>
    public string? ErrorMessage { get; set; }
}
