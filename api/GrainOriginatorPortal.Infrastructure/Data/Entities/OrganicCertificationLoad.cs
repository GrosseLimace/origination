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

    /// <summary>
    /// This producer's position in the run, 1..<see cref="RunTotal"/>.
    ///
    /// With <see cref="RunTotal"/> this is what makes completeness answerable. The run id alone
    /// groups the messages but says nothing about how many there should have been; the total
    /// supplies the denominator, carried on EVERY row rather than in one end-of-run message that
    /// could itself go missing.
    ///
    /// 🔑 The total counts every producer the sender CONSIDERED that night, not the ones it managed
    /// to send — and that is what makes the scheme work. The sender only discovers mid-run that a
    /// producer has no USDA record, so a send-count cannot be known up front. Skipped positions
    /// arrive as their own rows (status "Skipped") rather than as gaps, so "we hold RunTotal
    /// distinct positions for this run" still means the run finished.
    ///
    /// Null outside a nightly run: intraday one-off edits carry no run id, position or total, and
    /// that absence is how they are recognised.
    /// </summary>
    public int? RunPosition { get; set; }

    /// <summary>See <see cref="RunPosition"/>. Constant for the whole run.</summary>
    public int? RunTotal { get; set; }

    /// <summary>The NOP id this message carried, when it could be read. Null if the payload was
    /// unreadable — which is itself worth recording.</summary>
    public string? Nopid { get; set; }

    /// <summary>
    /// The Scoular customer code this message concerned.
    ///
    /// Needed because <see cref="Nopid"/> cannot always say WHO was involved: a skip with reason
    /// INELIGIBLE_NOP means the producer's NOP id is blank or a placeholder in master data, so
    /// there is no id to record. Without the customer code such a row could not be tied back to a
    /// producer at all, which would defeat the point of recording the skip.
    /// </summary>
    public string? ScoularId { get; set; }

    public DateTime ReceivedOn { get; set; }

    /// <summary>Received / Succeeded / Rejected / Skipped.</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>
    /// Why a producer was skipped, when <see cref="Status"/> is "Skipped". Null otherwise.
    ///
    /// Sender vocabulary, stored as a string rather than an enum for the same reason certification
    /// statuses are: an unrecognised value must be recorded and shown, never rejected. Known values
    /// today are NOT_IN_USDA and INELIGIBLE_NOP.
    ///
    /// This is the field that will finally explain the profile's "No certificate on file" warning.
    /// That state currently cannot distinguish "the feed has not reached us" from "USDA holds no
    /// record for them", and those mean very different things to a trader.
    /// </summary>
    public string? SkipReason { get; set; }

    public int Accepted { get; set; }
    public int Rejected { get; set; }

    /// <summary>Rows stored with no resolved CustomerId. Counted separately from Rejected because
    /// an onboarding gap is not a feed failure.</summary>
    public int UnmatchedCustomer { get; set; }

    /// <summary>Human-readable outcome. Must not contain payload content.</summary>
    public string? Message { get; set; }
}
