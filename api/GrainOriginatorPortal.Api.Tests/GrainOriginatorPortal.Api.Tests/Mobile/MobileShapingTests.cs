// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Mobile.Auditing;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Controllers;
using GrainOriginatorPortal.Mobile.Filters;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>Pure shaping logic behind the mobile cards: note cap + pin (card #644), ticket roll-up (card #646), audit redaction.</summary>
public class MobileShapingTests
{
    private static NoteDto Note(int id, DateTime createdAt, bool pinned = false) => new()
    {
        Id = id, CustomerId = 1, Content = $"note {id}", CreatedBy = "tester", CreatedAt = createdAt, IsPinned = pinned,
    };

    [Fact]
    public void RecentNotes_PinnedFirst_ThenNewest_CappedWithHasMore()
    {
        var t0 = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        var notes = Enumerable.Range(1, 12).Select(i => Note(i, t0.AddDays(i))).ToList();
        notes[2] = Note(3, t0.AddDays(3), pinned: true); // older pinned note

        var result = MobileNotesController.BuildRecent(notes, take: 10);

        Assert.NotNull(result.Pinned);
        Assert.Equal(3, result.Pinned!.Id);
        Assert.Equal(10, result.Notes.Count);
        Assert.Equal(12, result.Notes[0].Id);            // newest first
        Assert.DoesNotContain(result.Notes, n => n.Id == 3); // pinned not repeated in the list
        Assert.True(result.HasMore);                     // 11 non-pinned, 10 shown
    }

    [Fact]
    public void RecentNotes_SeveralPinned_TakesTheNewestPinned()
    {
        var t0 = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        var notes = new List<NoteDto> { Note(1, t0, pinned: true), Note(2, t0.AddDays(1), pinned: true), Note(3, t0.AddDays(2)) };

        var result = MobileNotesController.BuildRecent(notes, take: 10);

        Assert.Equal(2, result.Pinned!.Id);
        Assert.Equal([3, 1], result.Notes.Select(n => n.Id).ToArray());
        Assert.False(result.HasMore);
    }

    [Fact]
    public void RecentNotes_NoPinned_NoNotes_IsEmptyShell()
    {
        var result = MobileNotesController.BuildRecent([], take: 10);

        Assert.Null(result.Pinned);
        Assert.Empty(result.Notes);
        Assert.False(result.HasMore);
    }

    private static readonly IReadOnlyDictionary<string, decimal> Lbs = new Dictionary<string, decimal> { ["YC"] = 56m, ["SB"] = 60m };

    [Fact]
    public void TicketSummary_BushelsAreNullWhenACommodityHasNoConversion_AndAMissingWeightCountsAsZero()
    {
        var tickets = new List<TicketResponse>
        {
            new() { Id = 1, IsApplied = true, CtrmContractNumber = "C-1", ProductCode = "YC", AppliedDockQuantity = 5_600, IsActive = true },
            new() { Id = 2, IsApplied = true, CtrmContractNumber = "C-1", ProductCode = "YC", AppliedDockQuantity = null, IsActive = true },
            new() { Id = 3, IsApplied = false, ProductCode = "ZZ", AppliedDockQuantity = 1_000, IsActive = true },
        };

        var summary = MobileTicketsController.Summarise(tickets, cropYear: null, Lbs);

        Assert.Equal(100m, summary.Groups.Single(g => g.Key == "C-1").Bushels);
        Assert.Null(summary.Groups.Single(g => g.Key == MobileTicketsController.UnappliedKey).Bushels); // ZZ has no factor
        Assert.Null(summary.TotalBushels);
    }

    [Fact]
    public void TicketSummary_GroupsAppliedByContract_AndUnappliedTogether()
    {
        var tickets = new List<TicketResponse>
        {
            new() { Id = 1, IsApplied = true,  CtrmContractNumber = "C-1", ContractId = 11, ProductCode = "YC", AppliedDockQuantity = 56_000, ParsedDate = new DateTime(2026, 9, 1), IsActive = true },
            new() { Id = 2, IsApplied = true,  CtrmContractNumber = "C-1", ContractId = 11, ProductCode = "YC", AppliedDockQuantity = 28_000, ParsedDate = new DateTime(2026, 9, 2), IsActive = true },
            new() { Id = 3, IsApplied = false, CtrmContractNumber = null,  ProductCode = "SB", AppliedDockQuantity = 15_000, UnloadQuantity = 99_999m, ParsedDate = new DateTime(2026, 9, 3), IsActive = true },
            new() { Id = 4, IsApplied = false, CtrmContractNumber = "C-2", ProductCode = "SB", AppliedDockQuantity = 6_000, ParsedDate = new DateTime(2025, 10, 1), IsActive = true },
        };

        // Pounds ÷ the commodity's pounds per bushel, like the desktop (YC 56, SB 60). The load-level UnloadQuantity
        // on ticket 3 must be ignored: it is the whole truck, not this producer's share.
        var summary = MobileTicketsController.Summarise(tickets, cropYear: null, Lbs);

        Assert.Equal(4, summary.TotalTickets);
        Assert.Equal(1850m, summary.TotalBushels);
        Assert.Equal(2, summary.Groups.Count);

        var applied = summary.Groups.Single(g => g.Key == "C-1");
        Assert.Equal(2, applied.TicketCount);
        Assert.Equal(1500m, applied.Bushels);
        Assert.Equal(11, applied.ContractId);
        Assert.Equal(new DateTime(2026, 9, 2), applied.LastTicketDate);

        var unapplied = summary.Groups.Single(g => g.Key == MobileTicketsController.UnappliedKey);
        Assert.Equal(2, unapplied.TicketCount);          // unapplied tickets group together even with a contract number
        Assert.Equal(350m, unapplied.Bushels);
        Assert.Null(unapplied.ContractId);
        Assert.Equal(summary.Groups.Count - 1, summary.Groups.ToList().IndexOf(unapplied)); // unapplied sorts last
    }

    [Fact]
    public void TicketSummary_CropYearFilter_UsesTicketDateYear()
    {
        var tickets = new List<TicketResponse>
        {
            new() { Id = 1, IsApplied = true, CtrmContractNumber = "C-1", ProductCode = "YC", AppliedDockQuantity = 560, ParsedDate = new DateTime(2026, 3, 1), IsActive = true },
            new() { Id = 2, IsApplied = true, CtrmContractNumber = "C-1", ProductCode = "YC", AppliedDockQuantity = 1_120, ParsedDate = new DateTime(2025, 3, 1), IsActive = true },
        };

        var summary = MobileTicketsController.Summarise(tickets, cropYear: 2026, Lbs);

        Assert.Equal(1, summary.TotalTickets);
        Assert.Equal(10m, summary.TotalBushels);
    }

    [Fact]
    public void AuditScope_RedactsPhoneAndEmail_KeepsOtherFields()
    {
        var json = AuditScope.Redact(new
        {
            Name = "Producer A",
            PrimaryPhone = "402-555-0100",
            Contacts = new[] { new { Name = "Bob", Email = "bob@example.com" } },
            TotalAcres = 1200,
        });

        Assert.NotNull(json);
        Assert.Contains("\"name\":\"Producer A\"", json);
        Assert.Contains("\"totalAcres\":1200", json);
        Assert.DoesNotContain("402-555-0100", json);
        Assert.DoesNotContain("bob@example.com", json);
        Assert.Contains("\"primaryPhone\":\"sha256:", json);
        Assert.Contains("\"email\":\"sha256:", json);
    }

    [Fact]
    public void AuditScope_SameValue_SameFingerprint_SoChangesAreVisible()
    {
        var a = AuditScope.Redact(new { Phone = "1" });
        var b = AuditScope.Redact(new { Phone = "1" });
        var c = AuditScope.Redact(new { Phone = "2" });

        Assert.Equal(a, b);
        Assert.NotEqual(a, c);
    }

    [Theory]
    [InlineData("POST", "AUDIT_CREATE")]
    [InlineData("PUT", "AUDIT_UPDATE")]
    [InlineData("PATCH", "AUDIT_UPDATE")]
    [InlineData("DELETE", "AUDIT_DELETE")]
    [InlineData("GET", null)]
    [InlineData("HEAD", null)]
    public void AuditFilter_MapsVerbsToAuditCodes(string method, string? expected)
    {
        Assert.Equal(expected, MobileAuditActionFilter.AuditCodeFor(method));
    }
}
