// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers the CTRM ticket projection and the aliased batch document.
/// </summary>
/// <remarks>
/// The detail-row-per-producer rule is the important one. A ticket's header quantities describe the
/// whole load, so collapsing a split ticket to its header would attribute another producer's bushels
/// to whoever was asked about.
/// </remarks>
public class CtrmTicketMappingTests
{
    private static CtrmTicketDetailDto Detail(
        string customerCode = "TATOBIN",
        string? contractNumber = "PWW227420",
        string? cancelFlag = "N",
        int? sequence = 1,
        decimal? appliedNet = 57741m) => new()
    {
        CustomerCode = customerCode,
        ContractNumber = contractNumber,
        CancelFlag = cancelFlag,
        TicketSequenceNumber = sequence,
        AppliedNetQuantity = appliedNet,
        OrganizationCode = "2190",
        ElevatorCode = "01",
        GradeCode = "1YC",
        TicketType = "P",
        TicketStatusDescription = "Final Settled",
        GradeFactorMoisturePercent = 14.2m,
        GradeFactorTestWeightPercent = 56.5m,
        GradeFactorProteinPercent = 8.1m,
        FinalSettledDate = new DateTime(2026, 2, 3)
    };

    private static CtrmTicketDto Header(params CtrmTicketDetailDto[] details) => new()
    {
        TicketPrefix = "T",
        TicketNumber = "408279",
        TicketSuffix = "",
        TicketBLDate = new DateTime(2025, 11, 19),
        ProductCode = "YC",
        ShipmentTicketNumber = "T408279",
        UnloadOrganizationCode = "2190",
        UnloadQuantity = 120_000m,
        LoadoutQuantity = 0m,
        Details = details.ToList()
    };

    // -------------------------------------------------------------------------
    [Fact]
    public void EmitsOneTicketPerMatchingDetailRow()
    {
        // A split ticket: two rows for the same producer, plus one for someone else.
        var header = Header(
            Detail(sequence: 1, appliedNet: 30_000m),
            Detail(sequence: 2, appliedNet: 27_741m),
            Detail(customerCode: "OTHERCO", sequence: 3));

        var tickets = CtrmMappings.ToTickets(header, "TATOBIN");

        Assert.Equal(2, tickets.Count);
        Assert.All(tickets, t => Assert.Equal("TATOBIN", t.CustomerCode));
        Assert.Equal([30_000L, 27_741L], tickets.Select(t => t.AppliedDockQuantity));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void DetailRowsForOtherProducers_AreNotReturned()
    {
        var tickets = CtrmMappings.ToTickets(Header(Detail(customerCode: "OTHERCO")), "TATOBIN");

        Assert.Empty(tickets);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void CancelledDetailRows_AreDropped()
    {
        // The ODS view excludes cancellations upstream; whether CTRM does is unconfirmed, so this is
        // filtered defensively rather than assumed.
        var header = Header(
            Detail(cancelFlag: "Y", appliedNet: 11_111m),
            Detail(sequence: 2, cancelFlag: "N", appliedNet: 22_222m));

        var ticket = Assert.Single(CtrmMappings.ToTickets(header, "TATOBIN"));

        // The surviving row is the non-cancelled one, not merely "one of the two".
        Assert.Equal(22_222L, ticket.AppliedDockQuantity);
        Assert.True(ticket.IsActive);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void SplitTicketRows_GetDistinctIds()
    {
        // Both rows share all five key parts; only the sequence number separates them. If it were left
        // out of the hash they would collide and the client would dedupe one away.
        var header = Header(Detail(sequence: 1), Detail(sequence: 2));

        var tickets = CtrmMappings.ToTickets(header, "TATOBIN");

        Assert.Equal(2, tickets.Select(t => t.Id).Distinct().Count());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void DateIsFormattedLikeTheOdsStringColumn()
    {
        // ODS stores TicketBlDate as a string and sorts it lexicographically, so the format has to match
        // or ordering and any string comparison would behave differently on this path.
        var ticket = Assert.Single(CtrmMappings.ToTickets(Header(Detail()), "TATOBIN"));

        Assert.Equal("2025-11-19", ticket.Date);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void SentinelSettledDate_BecomesNull()
    {
        var header = Header(Detail());
        header.Details[0].FinalSettledDate = new DateTime(1, 1, 1);

        var ticket = Assert.Single(CtrmMappings.ToTickets(header, "TATOBIN"));

        Assert.Null(ticket.FinalSettledDate);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void QualityComesFromTheDetailRow_NotASeparateView()
    {
        var ticket = Assert.Single(CtrmMappings.ToTickets(Header(Detail()), "TATOBIN"));

        Assert.Equal(14.2m, ticket.Moisture);
        Assert.Equal(56.5m, ticket.TestWeight);
        Assert.Equal(8.1m, ticket.ProteinPercent);
        Assert.Equal("1YC", ticket.GradeCode);
    }

    // -------------------------------------------------------------------------
    [Theory]
    // U, L and C prefixes mean the bushels are not on a real purchase contract yet.
    [InlineData("UWW227420", false)]
    [InlineData("LWW227420", false)]
    [InlineData("CWW227420", false)]
    [InlineData("PWW227420", true)]
    [InlineData("SWW227420", true)]
    public void IsApplied_FollowsTheContractNumberPrefix(string contractNumber, bool expected)
    {
        // Requires the prefix character to survive mapping — without it every ticket reads as applied.
        var ticket = Assert.Single(
            CtrmMappings.ToTickets(Header(Detail(contractNumber: contractNumber)), "TATOBIN"));

        Assert.Equal(expected, ticket.IsApplied);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void OdsIgnoredFields_StayUnset_ForParity()
    {
        var ticket = Assert.Single(CtrmMappings.ToTickets(Header(Detail()), "TATOBIN"));

        // All Ignore()d on the ODS entity, so the ODS path never populates them either.
        Assert.Null(ticket.AppliedQuantity);
        Assert.Equal(0, ticket.GrossWeight);
        // Filled later by the ODS location lookup, exactly as on the ODS path.
        Assert.Null(ticket.ElevatorCity);
        Assert.Null(ticket.ElevatorState);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ForContract_KeepsEveryProducersRowOnThatContract()
    {
        // Backs the contracts table row expansion. A contract's applied bushels are the sum of ALL detail
        // rows against it, so filtering by producer here would understate a split load.
        var header = Header(
            Detail(customerCode: "TATOBIN", contractNumber: "PWW227420", appliedNet: 30_000m),
            Detail(customerCode: "OTHERCO", contractNumber: "PWW227420", sequence: 2, appliedNet: 20_000m),
            Detail(customerCode: "TATOBIN", contractNumber: "PWW999999", sequence: 3, appliedNet: 99_000m));

        var tickets = CtrmMappings.ToTicketsForContract(header, "PWW227420");

        Assert.Equal(2, tickets.Count);
        Assert.Equal(50_000L, tickets.Sum(t => t.AppliedDockQuantity ?? 0));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ForContract_StillDropsCancelledRows()
    {
        var header = Header(
            Detail(contractNumber: "PWW227420", cancelFlag: "Y", appliedNet: 11_111m),
            Detail(contractNumber: "PWW227420", cancelFlag: "N", sequence: 2, appliedNet: 22_222m));

        var ticket = Assert.Single(CtrmMappings.ToTicketsForContract(header, "PWW227420"));

        Assert.Equal(22_222L, ticket.AppliedDockQuantity);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ForContract_MatchIsTrimmedAndCaseInsensitive()
    {
        // ODS pads ContractNumber and the id arrives from a URL segment, so neither casing nor padding can
        // be relied on.
        var header = Header(Detail(contractNumber: "  pww227420 "));

        Assert.Single(CtrmMappings.ToTicketsForContract(header, "PWW227420"));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BatchDocument_AliasesOneRootFieldPerKey_AndPassesKeysAsVariables()
    {
        var keys = new List<CtrmTicketKey>
        {
            new("T", "408279", "", "2025-11-19", "YC"),
            new("T", "064558", "A", "2025-11-20", "SOY")
        };

        var (document, variables) = CtrmQueries.BuildTicketBatch(keys);

        Assert.Contains("t0: ticket(", document);
        Assert.Contains("t1: ticket(", document);

        // Keys travel as variables, never spliced into the document — no escaping questions and no
        // query-injection seam between ODS data and the CTRM query.
        Assert.DoesNotContain("408279", document);
        Assert.Equal("408279", variables["n0"]);
        Assert.Equal("064558", variables["n1"]);
        // An empty suffix is legitimate and verified against QA.
        Assert.Equal("", variables["s0"]);
        Assert.Equal("A", variables["s1"]);
        Assert.Equal("2025-11-19", variables["b0"]);
        Assert.Equal("YC", variables["c0"]);
        Assert.Equal(10, variables.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BatchDocument_ContainsNoHashComments()
    {
        // The WAF reads '#' as a SQL comment sequence and rejects the body with an HTML 403 the API
        // never sees.
        var (document, _) = CtrmQueries.BuildTicketBatch([new("T", "1", "", "2026-01-01", "YC")]);

        Assert.DoesNotContain('#', document);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BatchDocument_RejectsAnEmptyKeyList()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CtrmQueries.BuildTicketBatch([]));
    }
}
