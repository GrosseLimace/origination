namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Acknowledgement that a skip notice was recorded.
///
/// Deliberately thin. A skip stores no certification and has nothing to report about scopes, items
/// or customer matching, so reusing <see cref="OrganicCertificationIngestResponse"/> would hand the
/// sender a body of zeros and falses that reads like a failed ingest rather than a successful skip.
/// </summary>
public record OrganicCertificationSkipResponse
{
    /// <summary>Correlates this call with its OrganicCertificationLoad audit row, exactly as the
    /// ingest response does.</summary>
    public Guid BatchId { get; init; }

    /// <summary>Echoed so the sender can tie the response to what it sent without holding the
    /// request.</summary>
    public string? ScoularId { get; init; }

    /// <summary>The reason as received. Echoed rather than normalised — if we ever start
    /// interpreting these, the sender needs to see exactly what we recorded.</summary>
    public string? Reason { get; init; }

    /// <summary>Always true when the call returns 200. Present so the sender branches on a field
    /// rather than on the status code, matching the ingest response's shape.</summary>
    public bool Recorded { get; init; }
}
