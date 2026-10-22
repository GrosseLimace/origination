namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>What a <see cref="ICustomerSyncSource"/> returned for one run.</summary>
public sealed class CustomerSyncSourceResult
{
    public required string Source { get; init; }
    public bool Ok { get; init; } = true;
    public string? FailureCode { get; init; }
    public string? FailureDetail { get; init; }
    public List<CustomerSyncSourceRow> Rows { get; init; } = [];

    /// <summary>IsManual customers outside <see cref="Rows"/> that the master still knows.</summary>
    public Dictionary<long, CustomerSyncAttributes> ManualMaster { get; init; } = new();

    /// <summary>false ⇒ never deactivate a manual customer this run.</summary>
    public bool ManualMasterComplete { get; init; } = true;

    /// <summary>Manual customers the source cannot look up (never refreshed, never deactivated).</summary>
    public HashSet<long> ManualUnverifiable { get; init; } = [];

    public int CustomersMinted { get; init; }
    public CustomerSyncLookupInfo? Lookup { get; init; }
    public CustomerSyncDiscoveryInfo? Discovery { get; init; }

    public static CustomerSyncSourceResult Failed(string source, string code, string detail) =>
        new() { Source = source, Ok = false, FailureCode = code, FailureDetail = detail };
}

/// <summary>How the CTRM customer-master lookup went (counts and codes only, no PII).</summary>
public sealed class CustomerSyncLookupInfo
{
    public string Status { get; init; } = "";             // CtrmReadStatus.ToString()
    public string Permission { get; init; } = "unknown";  // granted | missing | unknown
    public int? HttpStatus { get; init; }
    public string? ErrorCode { get; init; }
    public string? Detail { get; init; }
    public int Requested { get; init; }
    public int Found { get; init; }
    public int Missing { get; init; }
    public int Duplicates { get; init; }
    public int Requests { get; init; }
}

/// <summary>How the CTRM contract/ticket link discovery went (counts only).</summary>
public sealed class CustomerSyncDiscoveryInfo
{
    public DateTime From { get; init; }
    public DateTime To { get; init; }
    public string ContractsStatus { get; init; } = "";
    public string TicketsStatus { get; init; } = "";
    public int ContractRows { get; init; }
    public int ContractPages { get; init; }
    public bool ContractsTruncated { get; init; }
    public int TicketRows { get; init; }
    public int TicketPages { get; init; }
    public bool TicketsTruncated { get; init; }
    public int ContractLinks { get; init; }
    public int TicketLinks { get; init; }
    public int NewCodes { get; init; }
    public int UnknownCodes { get; init; }
}
