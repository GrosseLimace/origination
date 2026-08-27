namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Per-request record of which source actually served the contract and ticket reads, surfaced to the
/// browser as response headers.
/// </summary>
/// <remarks>
/// <para>Without this, "is this screen showing CTRM data?" is only answerable by reading server logs,
/// and the two sources look identical on screen by design — that is the whole point of the mapping
/// work. A wrong answer to that question invalidates any comparison made against it, so provenance is
/// reported rather than inferred.</para>
///
/// <para>Registered scoped, so one instance covers one HTTP request. It records outcomes rather than
/// intentions: a read routed at CTRM that failed reports the failure, not <c>ctrm</c>.</para>
/// </remarks>
public sealed class CtrmProvenance
{
    public const string SourceHeader = "X-Data-Source";
    public const string ContractsHeader = "X-Data-Source-Contracts";
    public const string TicketsHeader = "X-Data-Source-Tickets";

    /// <summary>
    /// Which source the switches routed this request at — <c>ods</c> or <c>ctrm</c>. Null when this
    /// request performed no contract or ticket read at all.
    /// </summary>
    /// <remarks>
    /// Null rather than defaulting to <c>ods</c> on purpose. A default would stamp "ods" on every
    /// health check and customer search, making it look as though a contract read had happened and been
    /// served by ODS. The absence of the header is the honest signal that nothing was read.
    /// </remarks>
    public string? Source { get; private set; }

    /// <summary>Outcome of the contract read, e.g. <c>ctrm:ok:12</c> or <c>ctrm:EgressBlocked:0</c>.</summary>
    public string? Contracts { get; private set; }

    /// <summary>Outcome of the ticket read, in the same shape.</summary>
    public string? Tickets { get; private set; }

    /// <summary>
    /// Label for reads where ODS supplies the index and CTRM supplies the values.
    /// </summary>
    /// <remarks>
    /// Used only by the per-contract applied-ticket lookup. That read cannot come from the ticket window
    /// snapshot — a contract can be older than the window, and the window is capped at 366 days — so ODS
    /// is asked which tickets exist on the contract and CTRM is asked what each one currently says.
    /// Reporting it as plain <c>ctrm</c> would overstate what has moved off ODS: a ticket CTRM knows about
    /// and ODS has not yet ingested would not appear.
    /// </remarks>
    public const string OdsIndexedSource = "ctrm+ods-index";

    /// <summary>
    /// The failed CTRM read this request hit, if any - so the API can answer 503 instead of an empty list.
    /// </summary>
    /// <remarks>
    /// The repositories deliberately return an empty list on failure and never fall back to ODS. That is
    /// right for the data path and wrong for the caller: an empty list is indistinguishable from "this
    /// producer genuinely has no contracts", and it rendered as "no producers found" twice during
    /// development before anyone realised CTRM had timed out. Recording the failure here lets a filter turn
    /// it into an explicit error at the edge, without every repository method having to change its return
    /// type or every internal caller having to handle an exception.
    /// </remarks>
    public CtrmReadFailure? Failure { get; private set; }

    /// <summary>True when a read came back incomplete but usable - a page cap was hit.</summary>
    public bool Partial { get; private set; }

    public void RecordSource(string source) => Source = source;

    public void RecordContracts(string source, string outcome, int rows) => Contracts = Format(source, outcome, rows);

    public void RecordTickets(string source, string outcome, int rows) => Tickets = Format(source, outcome, rows);

    /// <summary>
    /// Records that a CTRM read failed. The FIRST failure is kept: it is the one that caused the rest.
    /// </summary>
    /// <remarks>
    /// Guarded by <see cref="CtrmReadFailure.IsFailure"/> so a status that merely means "incomplete"
    /// (<see cref="CtrmReadStatus.PartialSuccess"/>) or "fine" can never be promoted into a 503 by a
    /// caller passing it in from the wrong branch. Those go to <see cref="RecordPartial"/> instead.
    /// </remarks>
    public void RecordFailure(string what, CtrmReadStatus status, string? detail)
    {
        if (!CtrmReadFailure.IsFailure(status))
        {
            if (status == CtrmReadStatus.PartialSuccess) RecordPartial();
            return;
        }

        Failure ??= new CtrmReadFailure(what, status, detail);
    }

    /// <summary>Records that a read succeeded but was truncated, so the answer is incomplete.</summary>
    public void RecordPartial() => Partial = true;

    /// <summary>
    /// <c>source:outcome:rowCount</c> — compact enough for a header and enough to tell an empty
    /// result apart from a failed one, which look the same on screen.
    /// </summary>
    private static string Format(string source, string outcome, int rows) => $"{source}:{outcome}:{rows}";
}

/// <summary>What failed, and enough to act on it. <paramref name="What"/> is the read - "contracts" or
/// "tickets" - so the message can name it without leaking producer data.</summary>
public sealed record CtrmReadFailure(string What, CtrmReadStatus Status, string? Detail)
{
    /// <summary>Statuses that mean "the answer is missing", as opposed to legitimately empty.</summary>
    public static bool IsFailure(CtrmReadStatus status) => status is
        CtrmReadStatus.NotConfigured or CtrmReadStatus.TokenFailure or CtrmReadStatus.EgressBlocked
        or CtrmReadStatus.Unauthorized or CtrmReadStatus.Throttled or CtrmReadStatus.QueryError
        or CtrmReadStatus.Error or CtrmReadStatus.Warming;
}
