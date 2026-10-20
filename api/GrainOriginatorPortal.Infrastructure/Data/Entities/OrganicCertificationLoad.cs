namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One row per call to the certification ingest endpoint, written by this application whether the
/// call succeeded or failed.
///
/// Exists to answer "did the feed actually reach us, and what happened to it" without anyone
/// opening SSMS — the same reasoning as dbo.BarchartApiCallAudit, whose value showed up precisely
/// when a caller believed it had posted successfully and had not.
///
/// One row per MESSAGE rather than per run: the certification feed sends one producer per POST
/// (roughly a thousand nightly), so there is no batch to summarise. Note the consequence — with
/// no batch boundary, absence is undetectable: we cannot distinguish "not sent tonight" from
/// "unchanged", so IsActive can only be driven by an explicit Surrendered/Revoked status unless
/// the sender starts supplying a run id.
///
/// The payload is NEVER stored or logged here. Size and counts only.
/// </summary>
public class OrganicCertificationLoad
{
    public int Id { get; set; }

    /// <summary>Correlates with OrganicCertification.LoadBatchId and with the response returned
    /// to the caller.</summary>
    public Guid BatchId { get; set; }

    /// <summary>The NOP id this message carried, when it could be read. Null if the payload was
    /// unreadable — which is itself worth recording.</summary>
    public string? Nopid { get; set; }

    public DateTime ReceivedOn { get; set; }

    /// <summary>Succeeded / Failed / Rejected.</summary>
    public string Status { get; set; } = string.Empty;

    public int Accepted { get; set; }
    public int Rejected { get; set; }

    /// <summary>Rows stored with no resolved CustomerId. Counted separately from Rejected because
    /// an onboarding gap is not a feed failure.</summary>
    public int UnmatchedCustomer { get; set; }

    /// <summary>Human-readable outcome. Must not contain payload content.</summary>
    public string? Message { get; set; }
}
