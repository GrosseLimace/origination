// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// Pure ODS-vs-CTRM diff of two feeders' dry-run rows, for <c>GET api/diagnostics/customer-sync/compare</c>.
/// </summary>
/// <remarks>
/// <para><b>Identity is the producer code</b> (<c>ScoularId</c>, trimmed, compared case-insensitively and reported
/// upper-case), never the customer id: the CTRM side of a dry run carries negative placeholder ids for producers it
/// would mint. A row's code is the app's <c>ScoularId</c> for its id; a row whose id the app does not hold (a
/// placeholder, or an ODS customer the sync has not inserted yet) takes the code its own attributes carry.</para>
///
/// <para><b>Links</b> are <c>"{CODE}|{TU}"</c> with the trade unit trimmed (the CTRM feeder trims, plan §2 D-3, so
/// CHAR padding on the ODS side is not drift). A null or blank trade unit is a customer-presence-only row: it counts
/// as a customer, never as a link.</para>
///
/// <para><b>Fails visibly.</b> When either side failed, its half reports <c>Ok = false</c> with the failure code,
/// lookup and discovery reports (so a missing customers permission reads <c>CustomerPermission: "missing"</c>, not
/// "0 customers"), the other half stays populated, and the set and field diffs are left empty — a diff against a
/// side that read nothing would claim every producer is missing.</para>
///
/// <para><b>No PII.</b> Output is counts, codes (at most <see cref="MaxSamples"/> per list) and field names.</para>
/// </remarks>
public static class CustomerSyncComparer
{
    /// <summary>Most codes listed per sample list; the counts are never capped.</summary>
    public const int MaxSamples = 25;

    /// <summary>The Stage 1 fields both feeders write (plan D10), compared for customers present on both sides.</summary>
    private static readonly (string Field, Func<Customer, string?> Read)[] ComparedFields =
    [
        ("Name", c => c.Name),
        ("Phone", c => c.Phone),
        ("AddressLine1", c => c.AddressLine1),
        ("Location", c => c.Location),
        ("StateProvince", c => c.StateProvince),
        ("PostalCode", c => c.PostalCode),
        ("IndustryCode1", c => c.IndustryCode1),
        ("IndustryCode2", c => c.IndustryCode2),
    ];

    public static CustomerSyncComparison Compare(
        CustomerSyncSourceResult ods, CustomerSyncSourceResult ctrm, CustomerSyncAppState appState, DateTime nowUtc)
    {
        ArgumentNullException.ThrowIfNull(ods);
        ArgumentNullException.ThrowIfNull(ctrm);
        ArgumentNullException.ThrowIfNull(appState);

        var codeById = new Dictionary<long, string>();
        foreach (var customer in appState.Customers)
        {
            var code = NormaliseCode(customer.ScoularId);
            if (code is not null) codeById.TryAdd(customer.Id, code);
        }

        var odsView = SideView.Build(ods, codeById);
        var ctrmView = SideView.Build(ctrm, codeById);
        var bothOk = ods.Ok && ctrm.Ok;

        return new CustomerSyncComparison
        {
            GeneratedAtUtc = nowUtc,
            Ods = odsView.Describe(ods),
            Ctrm = ctrmView.Describe(ctrm),
            Customers = bothOk ? Diff(odsView.FirstRowByCode.Keys, ctrmView.FirstRowByCode.Keys) : new CustomerSyncSetDiff(),
            Links = bothOk ? Diff(odsView.Links, ctrmView.Links) : new CustomerSyncSetDiff(),
            Fields = bothOk ? FieldDiffs(odsView, ctrmView) : [],
            AppCustomers = appState.Customers.Count,
            AppActiveCustomers = appState.Customers.Count(c => c.IsActive),
            AppLinks = appState.TradeUnits.Count,
            AppActiveLinks = appState.TradeUnits.Count(t => t.IsActive)
        };
    }

    private static CustomerSyncSetDiff Diff(IEnumerable<string> ods, IEnumerable<string> ctrm)
    {
        var odsSet = ods.ToHashSet(StringComparer.Ordinal);
        var ctrmSet = ctrm.ToHashSet(StringComparer.Ordinal);
        var onlyOds = odsSet.Where(k => !ctrmSet.Contains(k)).OrderBy(k => k, StringComparer.Ordinal).ToList();
        var onlyCtrm = ctrmSet.Where(k => !odsSet.Contains(k)).OrderBy(k => k, StringComparer.Ordinal).ToList();

        return new CustomerSyncSetDiff
        {
            InBoth = odsSet.Count(ctrmSet.Contains),
            OnlyInOds = onlyOds.Count,
            OnlyInCtrm = onlyCtrm.Count,
            SampleOnlyInOds = [.. onlyOds.Take(MaxSamples)],
            SampleOnlyInCtrm = [.. onlyCtrm.Take(MaxSamples)]
        };
    }

    /// <summary>Applies each side's first row per code to a fresh <see cref="Customer"/> and compares the D10 fields.</summary>
    private static List<CustomerSyncFieldDiff> FieldDiffs(SideView ods, SideView ctrm)
    {
        var pairs = new List<(Customer Ods, Customer Ctrm)>();
        foreach (var (code, odsRow) in ods.FirstRowByCode)
        {
            if (!ctrm.FirstRowByCode.TryGetValue(code, out var ctrmRow)) continue;
            pairs.Add((Scratch(odsRow), Scratch(ctrmRow)));
        }

        return
        [
            .. ComparedFields.Select(f => new CustomerSyncFieldDiff
            {
                Field = f.Field,
                Compared = pairs.Count,
                Differs = pairs.Count(p => !string.Equals(NormaliseValue(f.Read(p.Ods)), NormaliseValue(f.Read(p.Ctrm)), StringComparison.Ordinal))
            })
        ];
    }

    private static Customer Scratch(CustomerSyncSourceRow row)
    {
        var customer = new Customer();
        row.Attributes.ApplyTo(customer);
        return customer;
    }

    private static string? NormaliseCode(string? code) =>
        string.IsNullOrWhiteSpace(code) ? null : code.Trim().ToUpperInvariant();

    private static string? NormaliseValue(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>One side's rows keyed by producer code.</summary>
    private sealed class SideView
    {
        public Dictionary<string, CustomerSyncSourceRow> FirstRowByCode { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Links { get; } = new(StringComparer.Ordinal);

        public static SideView Build(CustomerSyncSourceResult result, IReadOnlyDictionary<long, string> codeById)
        {
            var view = new SideView();
            foreach (var row in result.Rows)
            {
                var code = codeById.TryGetValue(row.CustomerId, out var appCode) ? appCode : NormaliseCode(Scratch(row).ScoularId);
                if (code is null) continue;

                view.FirstRowByCode.TryAdd(code, row);
                var tradeUnit = row.TradeUnit?.Trim();
                if (!string.IsNullOrEmpty(tradeUnit)) view.Links.Add($"{code}|{tradeUnit}");
            }
            return view;
        }

        public CustomerSyncComparisonSide Describe(CustomerSyncSourceResult result) => new()
        {
            Ok = result.Ok,
            FailureCode = result.FailureCode,
            FailureDetail = result.FailureDetail,
            Rows = result.Rows.Count,
            Customers = FirstRowByCode.Count,
            Links = Links.Count,
            Minted = result.CustomersMinted,
            CustomerPermission = result.Lookup?.Permission,
            Lookup = result.Lookup,
            Discovery = result.Discovery
        };
    }
}

/// <summary>The ODS-vs-CTRM diff report. Counts, codes and field names only.</summary>
public sealed class CustomerSyncComparison
{
    public DateTime GeneratedAtUtc { get; init; }
    public required CustomerSyncComparisonSide Ods { get; init; }
    public required CustomerSyncComparisonSide Ctrm { get; init; }

    /// <summary>Producer codes on each side; empty when either side failed.</summary>
    public CustomerSyncSetDiff Customers { get; init; } = new();

    /// <summary><c>"CODE|TU"</c> pairs on each side; empty when either side failed.</summary>
    public CustomerSyncSetDiff Links { get; init; } = new();

    /// <summary>One entry per compared field for producers on both sides; empty when either side failed.</summary>
    public List<CustomerSyncFieldDiff> Fields { get; init; } = [];

    public int AppCustomers { get; init; }
    public int AppActiveCustomers { get; init; }
    public int AppLinks { get; init; }
    public int AppActiveLinks { get; init; }
}

/// <summary>What one feeder returned on its dry run.</summary>
public sealed class CustomerSyncComparisonSide
{
    public bool Ok { get; init; }
    public string? FailureCode { get; init; }
    public string? FailureDetail { get; init; }

    /// <summary>Rows the feeder returned (one per customer and trade unit).</summary>
    public int Rows { get; init; }

    /// <summary>Distinct producer codes in those rows.</summary>
    public int Customers { get; init; }

    /// <summary>Distinct <c>"CODE|TU"</c> pairs in those rows.</summary>
    public int Links { get; init; }

    /// <summary>New producers the feeder would mint ids for (CTRM; placeholders on a dry run).</summary>
    public int Minted { get; init; }

    /// <summary><c>granted</c> | <c>missing</c> | <c>unknown</c> for the CTRM customers permission; null on ODS.</summary>
    public string? CustomerPermission { get; init; }

    public CustomerSyncLookupInfo? Lookup { get; init; }
    public CustomerSyncDiscoveryInfo? Discovery { get; init; }
}

/// <summary>Set comparison of producer codes or <c>"CODE|TU"</c> pairs, with at most 25 sample keys per side.</summary>
public sealed class CustomerSyncSetDiff
{
    public int InBoth { get; init; }
    public int OnlyInOds { get; init; }
    public int OnlyInCtrm { get; init; }
    public List<string> SampleOnlyInOds { get; init; } = [];
    public List<string> SampleOnlyInCtrm { get; init; } = [];
}

/// <summary>How many producers on both sides were compared on one field, and on how many the values differ.</summary>
public sealed class CustomerSyncFieldDiff
{
    public required string Field { get; init; }
    public int Compared { get; init; }
    public int Differs { get; init; }
}
