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
/// (roughly a thousand nightly), so there is no batch to summarise.
///
/// The sender began supplying a run id on 2026-10-07 and it is recorded in FeedRunId. That does
/// NOT yet make absence detection safe, and the distinction matters: knowing which producers a run
/// touched says nothing about whether the run FINISHED. A pipeline that sends 400 of 1,000 and
/// then dies would make 600 healthy producers look absent. Deactivating on absence needs an
/// end-of-run signal (or a size sanity-check) that we do not have, so IsActive is still driven by
/// an explicit Surrendered/Revoked status only.
///
/// The payload is NEVER stored or logged here. Size and counts only.
/// </summary>
public class OrganicCertificationLoad
{
    public int Id { get; set; }

    /// <summary>Correlates with OrganicCertification.LoadBatchId and with the response returned
    /// to the caller. OURS, not the sender's: a fresh Guid per POST. See FeedRunId for the
    /// sender's run-level key.</summary>
    public Guid BatchId { get; set; }

    /// <summary>
    /// The SENDER's run id, shared by every message in one nightly run. Null for anything that
    /// arrived before the pipeline began sending it (2026-10-07), and null is a legitimate value
    /// rather than a fault.
    ///
    /// This is what gives the feed a batch boundary. With it, "how many messages did run X carry
    /// and how many failed" becomes one indexed query over this table.
    /// </summary>
    public string? FeedRunId { get; set; }

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
