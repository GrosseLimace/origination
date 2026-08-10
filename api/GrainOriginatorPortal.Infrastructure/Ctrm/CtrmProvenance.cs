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

    public void RecordSource(string source) => Source = source;

    public void RecordContracts(string source, string outcome, int rows) => Contracts = Format(source, outcome, rows);

    public void RecordTickets(string source, string outcome, int rows) => Tickets = Format(source, outcome, rows);

    /// <summary>
    /// <c>source:outcome:rowCount</c> — compact enough for a header and enough to tell an empty
    /// result apart from a failed one, which look the same on screen.
    /// </summary>
    private static string Format(string source, string outcome, int rows) => $"{source}:{outcome}:{rows}";
}
