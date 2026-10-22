// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The ODS-vs-CTRM diff behind <c>GET api/diagnostics/customer-sync/compare</c>. Identity is the producer code
/// (<c>ScoularId</c>, trimmed, case-insensitive), never the customer id: the CTRM side of a dry run carries
/// negative placeholder ids for producers it would mint. Output is codes and counts only.
/// </summary>
public class CustomerSyncComparerTests
{
    private static readonly DateTime Now = new(2026, 10, 6, 12, 0, 0, DateTimeKind.Utc);

    private readonly List<Customer> _appCustomers = [];
    private readonly List<CustomerTradeUnit> _appTradeUnits = [];

    private CustomerSyncAppState App() => new() { Customers = _appCustomers, TradeUnits = _appTradeUnits };

    private void AppCustomer(long id, string code, bool isActive = true) =>
        _appCustomers.Add(new Customer { Id = id, ScoularId = code, Name = "Farm", IsActive = isActive });

    private static CustomerSyncSourceRow Row(long id, string? tradeUnit, CustomerSyncAttributes? attributes = null) =>
        new() { CustomerId = id, TradeUnit = tradeUnit, Attributes = attributes ?? new Attrs() };

    private static CustomerSyncSourceResult Side(string source, params CustomerSyncSourceRow[] rows) =>
        new() { Source = source, Rows = [.. rows] };

    [Fact]
    public void Compare_CountsCustomersAndLinksInBoth_OnlyOds_OnlyCtrm_WithCappedSamples()
    {
        AppCustomer(1, "A");
        AppCustomer(2, "B");
        AppCustomer(3, "C");
        var ods = Side("ods", Row(1, "1085"), Row(1, "2200"), Row(2, "1085"));
        var ctrm = Side("ctrm", Row(1, "1085"), Row(3, "9000"));

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, App(), Now);

        Assert.Equal(1, comparison.Customers.InBoth);
        Assert.Equal(1, comparison.Customers.OnlyInOds);
        Assert.Equal(1, comparison.Customers.OnlyInCtrm);
        Assert.Equal(["B"], comparison.Customers.SampleOnlyInOds);
        Assert.Equal(["C"], comparison.Customers.SampleOnlyInCtrm);
        Assert.Equal(1, comparison.Links.InBoth);
        Assert.Equal(2, comparison.Links.OnlyInOds);
        Assert.Equal(1, comparison.Links.OnlyInCtrm);
        Assert.Equal(["A|2200", "B|1085"], comparison.Links.SampleOnlyInOds);
        Assert.Equal(["C|9000"], comparison.Links.SampleOnlyInCtrm);
        Assert.Equal(Now, comparison.GeneratedAtUtc);
        Assert.Equal(3, comparison.Ods.Rows);
        Assert.Equal(2, comparison.Ods.Customers);
        Assert.Equal(3, comparison.Ods.Links);
        Assert.Equal(2, comparison.Ctrm.Customers);
        Assert.Equal(2, comparison.Ctrm.Links);
    }

    [Fact]
    public void Compare_SamplesAreCappedAt25_AndCountsAreNot()
    {
        for (var i = 0; i < 30; i++) AppCustomer(100 + i, $"P{i:D2}");
        var ods = Side("ods", [.. Enumerable.Range(0, 30).Select(i => Row(100 + i, "1085"))]);
        var ctrm = Side("ctrm");

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, App(), Now);

        Assert.Equal(30, comparison.Customers.OnlyInOds);
        Assert.Equal(25, comparison.Customers.SampleOnlyInOds.Count);
        Assert.Equal(30, comparison.Links.OnlyInOds);
        Assert.Equal(25, comparison.Links.SampleOnlyInOds.Count);
        Assert.Equal("P00", comparison.Customers.SampleOnlyInOds[0]);
    }

    [Fact]
    public void Compare_MatchesOnTrimmedCaseInsensitiveCode_AndTrimmedTradeUnit()
    {
        AppCustomer(1, " smitfar ");
        var ods = Side("ods", Row(1, "1085 "));
        // The CTRM side of a dry run: a different (placeholder) id, the code carried by the row's attributes.
        var ctrm = Side("ctrm", Row(-1, "1085", new Attrs(code: "SMITFAR")));

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, App(), Now);

        Assert.Equal(1, comparison.Customers.InBoth);
        Assert.Equal(0, comparison.Customers.OnlyInOds + comparison.Customers.OnlyInCtrm);
        Assert.Equal(1, comparison.Links.InBoth);
        Assert.Equal(0, comparison.Links.OnlyInOds + comparison.Links.OnlyInCtrm);
    }

    [Fact]
    public void Compare_MintedPlaceholderIds_TakeTheirCodeFromTheRowAttributes()
    {
        var dto = new CtrmCustomerDto { SourceCode = " NEWPROD ", Name = "New Farm", ActiveYN = "Y", IndustryCode1 = "PR" };
        var ctrm = new CustomerSyncSourceResult
        {
            Source = "ctrm",
            CustomersMinted = 1,
            Rows = [Row(-1, "1085", new CtrmCustomerSyncAttributes(dto))]
        };

        var comparison = CustomerSyncComparer.Compare(Side("ods"), ctrm, App(), Now);

        Assert.Equal(["NEWPROD"], comparison.Customers.SampleOnlyInCtrm);
        Assert.Equal(["NEWPROD|1085"], comparison.Links.SampleOnlyInCtrm);
        Assert.Equal(1, comparison.Ctrm.Minted);
    }

    [Fact]
    public void Compare_FieldDiffs_CountOnlyCustomersInBoth_AfterTrim()
    {
        AppCustomer(1, "A");
        AppCustomer(2, "B");
        var ods = Side("ods",
            Row(1, "1085", new Attrs(name: "Smith Farms ", phone: "555-0100")),
            Row(2, "1085", new Attrs(name: "Only Ods", phone: "1")));
        var ctrm = Side("ctrm", Row(1, "1085", new Attrs(name: "Smith Farms", phone: "555-0199")));

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, App(), Now);

        var name = Assert.Single(comparison.Fields, f => f.Field == "Name");
        Assert.Equal(1, name.Compared);
        Assert.Equal(0, name.Differs);
        var phone = Assert.Single(comparison.Fields, f => f.Field == "Phone");
        Assert.Equal(1, phone.Compared);
        Assert.Equal(1, phone.Differs);
        Assert.Equal(
            ["Name", "Phone", "AddressLine1", "Location", "StateProvince", "PostalCode", "IndustryCode1", "IndustryCode2"],
            comparison.Fields.Select(f => f.Field));
    }

    [Fact]
    public void Compare_FieldDiffs_TreatNullAndBlankAsEqual()
    {
        AppCustomer(1, "A");
        var ods = Side("ods", Row(1, "1085", new Attrs(name: "Farm", phone: "")));
        var ctrm = Side("ctrm", Row(1, "1085", new Attrs(name: "Farm", phone: null)));

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, App(), Now);

        Assert.All(comparison.Fields, f => Assert.Equal(0, f.Differs));
    }

    [Fact]
    public void Compare_CtrmFailed_ReportsTheSideAsNotOk_WithPermission_AndSkipsDiffs()
    {
        AppCustomer(1, "A");
        var ods = Side("ods", Row(1, "1085"));
        var discovery = new CustomerSyncDiscoveryInfo { ContractsStatus = "Ok", TicketsStatus = "Ok", ContractLinks = 4 };
        var ctrm = new CustomerSyncSourceResult
        {
            Source = "ctrm",
            Ok = false,
            FailureCode = "CUSTOMER_SYNC_NO_PERMISSION",
            FailureDetail = "CTRM customer lookup failed (Unauthorized, HTTP 403)",
            Lookup = new CustomerSyncLookupInfo { Status = "Unauthorized", Permission = "missing", HttpStatus = 403, Requested = 1 },
            Discovery = discovery
        };

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, App(), Now);

        Assert.False(comparison.Ctrm.Ok);
        Assert.Equal("missing", comparison.Ctrm.CustomerPermission);
        Assert.Equal("CUSTOMER_SYNC_NO_PERMISSION", comparison.Ctrm.FailureCode);
        Assert.Same(discovery, comparison.Ctrm.Discovery);
        Assert.Equal(0, comparison.Customers.InBoth + comparison.Customers.OnlyInOds + comparison.Customers.OnlyInCtrm);
        Assert.Empty(comparison.Customers.SampleOnlyInOds);
        Assert.Equal(0, comparison.Links.InBoth + comparison.Links.OnlyInOds + comparison.Links.OnlyInCtrm);
        Assert.Empty(comparison.Fields);
        // The ODS half stays populated.
        Assert.True(comparison.Ods.Ok);
        Assert.Equal(1, comparison.Ods.Customers);
        Assert.Equal(1, comparison.Ods.Links);
        Assert.Null(comparison.Ods.CustomerPermission);
    }

    [Fact]
    public void Compare_OdsFailed_SkipsDiffs_AndKeepsTheCtrmHalf()
    {
        AppCustomer(1, "A");
        var ods = CustomerSyncSourceResult.Failed("ods", "CUSTOMER_SYNC_SOURCE_UNAVAILABLE", "SqlException");
        var ctrm = new CustomerSyncSourceResult
        {
            Source = "ctrm",
            Rows = [Row(1, "1085")],
            Lookup = new CustomerSyncLookupInfo { Status = "Ok", Permission = "granted", Requested = 1, Found = 1 }
        };

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, App(), Now);

        Assert.False(comparison.Ods.Ok);
        Assert.Equal("SqlException", comparison.Ods.FailureDetail);
        Assert.True(comparison.Ctrm.Ok);
        Assert.Equal("granted", comparison.Ctrm.CustomerPermission);
        Assert.Equal(1, comparison.Ctrm.Customers);
        Assert.Equal(0, comparison.Customers.OnlyInCtrm);
        Assert.Empty(comparison.Fields);
    }

    [Fact]
    public void Compare_NullTradeUnitRows_CountAsCustomersNotLinks()
    {
        AppCustomer(1, "A");
        AppCustomer(2, "B");
        var ods = Side("ods", Row(1, null), Row(2, ""));
        var ctrm = Side("ctrm", Row(1, null), Row(2, "  "));

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, App(), Now);

        Assert.Equal(2, comparison.Customers.InBoth);
        Assert.Equal(2, comparison.Ods.Customers);
        Assert.Equal(0, comparison.Ods.Links);
        Assert.Equal(0, comparison.Ctrm.Links);
        Assert.Equal(0, comparison.Links.InBoth + comparison.Links.OnlyInOds + comparison.Links.OnlyInCtrm);
    }

    [Fact]
    public void Compare_ReportsTheAppTotals()
    {
        AppCustomer(1, "A");
        AppCustomer(2, "B", isActive: false);
        _appTradeUnits.Add(new CustomerTradeUnit { CustomerId = 1, TradeUnit = "1085", IsActive = true });
        _appTradeUnits.Add(new CustomerTradeUnit { CustomerId = 1, TradeUnit = "2200", IsActive = false });
        _appTradeUnits.Add(new CustomerTradeUnit { CustomerId = 2, TradeUnit = "1085", IsActive = false });

        var comparison = CustomerSyncComparer.Compare(Side("ods"), Side("ctrm"), App(), Now);

        Assert.Equal(2, comparison.AppCustomers);
        Assert.Equal(1, comparison.AppActiveCustomers);
        Assert.Equal(3, comparison.AppLinks);
        Assert.Equal(1, comparison.AppActiveLinks);
    }

    /// <summary>Sets the code and the compared fields verbatim — no trimming — so the comparer's own normalisation is what is tested.</summary>
    private sealed class Attrs : CustomerSyncAttributes
    {
        private readonly string? _code;
        private readonly string _name;
        private readonly string? _phone;

        public Attrs(string? code = null, string name = "Farm", string? phone = "555")
        {
            _code = code;
            _name = name;
            _phone = phone;
        }

        public override void ApplyTo(Customer target)
        {
            if (_code is not null) target.ScoularId = _code;
            target.Name = _name;
            target.Phone = _phone;
        }
    }
}
