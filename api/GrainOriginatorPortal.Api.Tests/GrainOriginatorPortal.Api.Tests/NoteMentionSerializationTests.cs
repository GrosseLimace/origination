using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Locks the JSON contract for the dbo.Notes.Mentions column. NoteService serializes mentions with a
/// plain JsonSerializer.Serialize (default options → PascalCase unless overridden), while the Instant
/// Share Note Logic App reads the keys case-sensitively as lowercase (item()?['type'/'id'/'email']).
/// If these keys ever regress to PascalCase the Logic App silently resolves no recipients and sends
/// nothing — no error — so guard the exact wire shape here.
/// </summary>
public class NoteMentionSerializationTests
{
    private static readonly NoteMention Sample = new()
    {
        Type = "person",
        Id = "CEgr",
        Name = "Caden Egr",
        Email = "CEgr@scoular.com"
    };

    [Fact]
    public void SerializesWithLowercaseKeys_MatchingLogicAppContract()
    {
        // Mirrors NoteService.SerializeMentions — default serializer, no options.
        var json = JsonSerializer.Serialize(new[] { Sample });

        Assert.Contains("\"type\":\"person\"", json);
        Assert.Contains("\"id\":\"CEgr\"", json);
        Assert.Contains("\"name\":\"Caden Egr\"", json);
        Assert.Contains("\"email\":\"CEgr@scoular.com\"", json);
        // Must NOT emit PascalCase keys the Logic App cannot read.
        Assert.DoesNotContain("\"Type\"", json);
        Assert.DoesNotContain("\"Id\"", json);
    }

    [Fact]
    public void RoundTripsThroughDefaultSerializer()
    {
        // NoteMappings deserializes the stored column with a default JsonSerializer.Deserialize.
        var json = JsonSerializer.Serialize(new[] { Sample });
        var back = JsonSerializer.Deserialize<List<NoteMention>>(json);

        Assert.NotNull(back);
        var m = Assert.Single(back!);
        Assert.Equal("person", m.Type);
        Assert.Equal("CEgr", m.Id);
        Assert.Equal("Caden Egr", m.Name);
        Assert.Equal("CEgr@scoular.com", m.Email);
    }

    // ── ToResponse mention deserialization (NoteMappings) ─────────────────────────────────────
    // Guards the GET /api/notes 500 that occurred when a stored Mentions blob didn't match the
    // (now lowercase, required) NoteMention contract. The mapping must be tolerant.

    private static Note NoteWith(string? mentionsJson) => new()
    {
        Id = 1,
        CustomerId = 100,
        CustomerName = "Acme Farms",
        CreatedBy = "CEgr",
        Description = "note body",
        MentionsJson = mentionsJson
    };

    [Fact]
    public void ToResponse_ParsesCurrentLowercaseMentions()
    {
        var resp = NoteWith("[{\"type\":\"trade-unit\",\"id\":\"OMAHA\",\"name\":\"Omaha TU\"}]")
            .ToResponse(new Dictionary<string, string>());
        var m = Assert.Single(resp.Mentions);
        Assert.Equal("trade-unit", m.Type);
        Assert.Equal("OMAHA", m.Id);
    }

    [Fact]
    public void ToResponse_ParsesLegacyPascalCaseMentions()
    {
        // Pre-lowercase-contract rows still deserialize (case-insensitive) rather than 500.
        var resp = NoteWith("[{\"Type\":\"person\",\"Id\":\"CEgr\",\"Name\":\"Caden Egr\",\"Email\":\"CEgr@scoular.com\"}]")
            .ToResponse(new Dictionary<string, string>());
        var m = Assert.Single(resp.Mentions);
        Assert.Equal("person", m.Type);
        Assert.Equal("CEgr", m.Id);
        Assert.Equal("Caden Egr", m.Name);
    }

    [Fact]
    public void ToResponse_BlobMissingRequiredFieldsDegradesToEmpty()
    {
        // The exact shape that 500'd the notes list: a stored blob that doesn't satisfy the
        // required NoteMention fields must degrade to an empty list, not throw.
        var resp = NoteWith("[{\"foo\":\"bar\"}]").ToResponse(new Dictionary<string, string>());
        Assert.Empty(resp.Mentions);
    }

    [Fact]
    public void ToResponse_MalformedJsonDegradesToEmpty()
    {
        var resp = NoteWith("{ not valid json").ToResponse(new Dictionary<string, string>());
        Assert.Empty(resp.Mentions);
    }

    [Fact]
    public void ToResponse_NullMentionsIsEmpty()
    {
        var resp = NoteWith(null).ToResponse(new Dictionary<string, string>());
        Assert.Empty(resp.Mentions);
    }

    // ── Mention normalization on write (M-xxx / CWE-284 external-exfiltration guard) ───────────
    // The persisted person email drives the Instant Share Note Logic App's sendMail recipient, so
    // NoteService must never persist a client-supplied email — it derives the address from the id
    // (internal UPN), forcing @scoular.com. These go through CreateAsync and capture what actually
    // lands in the Notes.Mentions column.

    private static (NoteService svc, List<string?> captured) BuildServiceCapturingMentions(
        params RecapGroupDto[] visibleGroups)
        => BuildServiceCapturingMentions(out Mock<IDailyRecapGroupService> _, out Mock<IEntitlementsRepository> _, visibleGroups);

    /// <param name="groups">The recap-group service mock, exposed so a test can make it throw or
    /// assert it was never consulted.</param>
    private static (NoteService svc, List<string?> captured) BuildServiceCapturingMentions(
        out Mock<IDailyRecapGroupService> groups, params RecapGroupDto[] visibleGroups)
        => BuildServiceCapturingMentions(out groups, out Mock<IEntitlementsRepository> _, visibleGroups);

    /// <param name="groups">The recap-group service mock, exposed so a test can make it throw or
    /// assert it was never consulted.</param>
    /// <param name="entitlements">The user-roster mock. Defaults to treating every id it is asked
    /// about as an active user, so tests that aren't about H-056 don't have to seed a roster.</param>
    private static (NoteService svc, List<string?> captured) BuildServiceCapturingMentions(
        out Mock<IDailyRecapGroupService> groups, out Mock<IEntitlementsRepository> entitlements,
        params RecapGroupDto[] visibleGroups)
    {
        var captured = new List<string?>();
        var repo = new Mock<INoteRepository>();
        var note = new Note { Id = 1, CustomerId = 100, CustomerName = "Acme", CreatedBy = "CEgr", Description = "body" };
        repo.Setup(r => r.AddAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<long, string, string?, string?, string, CancellationToken>((_, _, _, mentionsJson, _, _) => captured.Add(mentionsJson))
            .ReturnsAsync(note);
        repo.Setup(r => r.UpdateAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<bool>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<long, string, string?, bool, string, CancellationToken>((_, _, mentionsJson, _, _, _) => captured.Add(mentionsJson))
            .ReturnsAsync(note);

        var customerRepo = new Mock<ICustomerRepository>();
        customerRepo.Setup(c => c.GetFirstActiveTradeUnitAsync(It.IsAny<long>(), It.IsAny<CancellationToken>())).ReturnsAsync("OMAHA");
        var names = new Mock<IDisplayNameLookupRepository>();
        names.Setup(n => n.ResolveAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        var ctx = new Mock<IRequestContextService>();
        ctx.Setup(c => c.GetCurrentUser()).Returns("CEgr");

        groups = new Mock<IDailyRecapGroupService>();
        groups.Setup(g => g.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync(visibleGroups.ToList());

        entitlements = new Mock<IEntitlementsRepository>();
        entitlements.Setup(e => e.GetActiveUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyCollection<string> ids, CancellationToken _) => ids.ToHashSet(StringComparer.OrdinalIgnoreCase));

        var svc = new NoteService(repo.Object, customerRepo.Object, names.Object, ctx.Object,
            groups.Object, entitlements.Object, new Mock<ILogger<NoteService>>().Object);
        return (svc, captured);
    }

    private static RecapGroupDto Group(int id, string name, params RecapGroupMemberDto[] members) => new()
    {
        Id = id,
        Name = name,
        Members = members.ToList(),
    };

    [Fact]
    public async Task CreateAsync_OverwritesClientSuppliedPersonEmail_WithIdDerivedInternalAddress()
    {
        var (svc, captured) = BuildServiceCapturingMentions();
        var mentions = new[]
        {
            new NoteMention { Type = "person", Id = "SFletcher", Name = "S Fletcher", Email = "attacker@evil.com" }
        };

        await svc.CreateAsync(100, "note body", mentions, CancellationToken.None);

        var json = Assert.Single(captured);
        var stored = JsonSerializer.Deserialize<List<NoteMention>>(json!)!;
        Assert.Equal("SFletcher@scoular.com", stored[0].Email);   // external address rejected
        Assert.DoesNotContain("evil.com", json);
    }

    [Fact]
    public async Task CreateAsync_KeepsUpnIdAsIs_WhenItAlreadyCarriesTheInternalDomain()
    {
        var (svc, captured) = BuildServiceCapturingMentions();
        var mentions = new[]
        {
            new NoteMention { Type = "person", Id = "SFletcher@scoular.com", Name = "S Fletcher", Email = "spoof@evil.com" }
        };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        var stored = JsonSerializer.Deserialize<List<NoteMention>>(Assert.Single(captured)!)!;
        Assert.Equal("SFletcher@scoular.com", stored[0].Email);
    }

    // The id is client-authored too, so sanitizing only the email field left the boundary open:
    // a person mention with Id="attacker@evil.com" previously passed through untouched and the
    // Logic App would have mailed the note there. These pin the id-side domain validation.

    [Theory]
    [InlineData("attacker@evil.com")]              // foreign domain
    [InlineData("attacker@EVIL.com")]              // foreign domain, mixed case
    [InlineData("attacker@evil.com@scoular.com")]  // extra '@' — trailing internal domain must not launder it
    [InlineData("attacker@scoular.com.evil.com")]  // lookalike domain
    [InlineData("@scoular.com")]                   // empty local part
    public async Task CreateAsync_RejectsPersonMentionWhoseIdIsNotAnInternalIdentity(string forgedId)
    {
        var (svc, captured) = BuildServiceCapturingMentions();
        var mentions = new[] { new NoteMention { Type = "person", Id = forgedId, Name = "Mallory" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.CreateAsync(100, "note body", mentions, CancellationToken.None));
        Assert.Empty(captured);   // nothing persisted
    }

    [Fact]
    public async Task UpdateAsync_AlsoRejectsForgedPersonMentionIds()
    {
        // The edit path serializes mentions through the same helper — guard it too.
        var (svc, _) = BuildServiceCapturingMentions();
        var mentions = new[] { new NoteMention { Type = "person", Id = "attacker@evil.com", Name = "Mallory" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.UpdateAsync(1, "edited", mentions, CancellationToken.None));
    }

    [Fact]
    public async Task CreateAsync_StripsEmailFromTradeUnitAndGroupMentions()
    {
        var (svc, captured) = BuildServiceCapturingMentions();
        var mentions = new[]
        {
            new NoteMention { Type = "trade-unit", Id = "OMAHA", Name = "Omaha TU", Email = "attacker@evil.com" },
            new NoteMention { Type = "trade-unit-group", Id = "5", Name = "West Group", Email = "attacker@evil.com" }
        };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        var stored = JsonSerializer.Deserialize<List<NoteMention>>(Assert.Single(captured)!)!;
        Assert.All(stored, m => Assert.Null(m.Email));
        Assert.DoesNotContain("evil.com", captured[0]);
    }

    // ── Group ("app-group") mention expansion ──────────────────────────────────────────────────
    // A group is flattened server-side into its member references, so the Logic App resolves them
    // with the three cases it already has. The group row itself is kept for display/provenance and
    // is inert there. These tests pin the two properties that make that safe: every stored row is a
    // type the deployed workflow understands, and expansion runs BEFORE normalization so group
    // members can't dodge the M-025 rules.

    private static readonly RecapGroupMemberDto PersonMember =
        new() { Type = "person", Id = "SFletcher", Name = "Sam Fletcher", Email = "SFletcher@scoular.com" };
    private static readonly RecapGroupMemberDto TradeUnitMember =
        new() { Type = "trade-unit", Id = "1084", Name = "1084" };
    private static readonly RecapGroupMemberDto TradeUnitGroupMember =
        new() { Type = "trade-unit-group", Id = "12", Name = "West Group" };

    private static List<NoteMention> StoredMentions(List<string?> captured) =>
        JsonSerializer.Deserialize<List<NoteMention>>(Assert.Single(captured)!)!;

    [Fact]
    public async Task CreateAsync_ExpandsGroupMention_IntoGroupRowPlusOneRowPerMember()
    {
        var (svc, captured) = BuildServiceCapturingMentions(
            Group(7, "Corn Belt", PersonMember, TradeUnitMember, TradeUnitGroupMember));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        await svc.CreateAsync(100, "note body", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        Assert.Equal(4, stored.Count);
        Assert.Equal("app-group", stored[0].Type);
        Assert.Null(stored[0].Via);                       // the row the user actually picked
        Assert.Equal(["person", "trade-unit", "trade-unit-group"], stored.Skip(1).Select(m => m.Type));
        Assert.Equal(["1084", "12"], stored.Skip(2).Select(m => m.Id));
        Assert.All(stored.Skip(1), m => Assert.Equal("app-group:7", m.Via));
    }

    [Fact]
    public async Task CreateAsync_GroupMention_AlwaysStoresAtLeastOneTypeTheLogicAppResolves()
    {
        // The regression guard for "silently emails nobody": the app-group row itself resolves to no
        // recipients in the workflow, so a non-empty group MUST also contribute rows it understands.
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt", PersonMember));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        string[] resolvable = ["person", "trade-unit", "trade-unit-group"];
        Assert.Contains(StoredMentions(captured), m => resolvable.Contains(m.Type));
    }

    [Fact]
    public async Task CreateAsync_ExpandedPersonMember_GetsIdDerivedInternalEmail()
    {
        // Order test: expansion emits the member, normalization then rebuilds its address. If the two
        // steps were ever swapped, a stored group member email would pass straight through.
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt",
            new RecapGroupMemberDto { Type = "person", Id = "SFletcher", Name = "Sam", Email = "attacker@evil.com" }));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        Assert.Equal("SFletcher@scoular.com", stored[1].Email);
        Assert.DoesNotContain("evil.com", captured[0]);
        Assert.Null(stored[0].Email);   // the group row never carries an address
    }

    [Theory]
    [InlineData("attacker@evil.com")]
    [InlineData("attacker@EVIL.com")]
    [InlineData("attacker@evil.com@scoular.com")]
    [InlineData("attacker@scoular.com.evil.com")]
    [InlineData("@scoular.com")]
    public async Task CreateAsync_RejectsForgedPersonIdArrivingViaGroupMember(string forgedId)
    {
        // The group path must not become a laundering route around the rule the direct path enforces.
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt",
            new RecapGroupMemberDto { Type = "person", Id = forgedId, Name = "Mallory" }));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.CreateAsync(100, "note body", mentions, CancellationToken.None));
        Assert.Empty(captured);
    }

    [Fact]
    public async Task CreateAsync_RejectsMentionOfAnEmptyGroup()
    {
        // Same failure mode as an unknown type: the app-group row alone resolves to no recipients,
        // so this would save a note the author believes was shared and notify nobody.
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt"));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.CreateAsync(100, "b", mentions, CancellationToken.None));
        Assert.Empty(captured);
    }

    [Fact]
    public async Task CreateAsync_RejectsMentionOfGroupTheCallerCannotSee()
    {
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt", PersonMember));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "999", Name = "Someone Else's" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.CreateAsync(100, "b", mentions, CancellationToken.None));
        Assert.Empty(captured);   // rejected, never silently dropped
    }

    [Fact]
    public async Task CreateAsync_FailsClosed_WhenGroupsCannotBeLoaded()
    {
        var (svc, captured) = BuildServiceCapturingMentions(out var groups, Group(7, "Corn Belt", PersonMember));
        groups.Setup(g => g.GetAllAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("db down"));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => svc.CreateAsync(100, "b", mentions, CancellationToken.None));
        Assert.Equal(503, ex.HttpStatusCode);
        Assert.Empty(captured);
    }

    [Fact]
    public async Task CreateAsync_UsesTheServerSideGroupName_AndIgnoresClientSuppliedProvenance()
    {
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt", PersonMember));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Executives", Via = "app-group:999" } };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        Assert.Equal("Corn Belt", stored[0].Name);   // client's label loses to the real one
        Assert.Null(stored[0].Via);                  // forged provenance cleared
    }

    [Fact]
    public async Task CreateAsync_DedupesPersonMentionedDirectlyAndThroughAGroup()
    {
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt", PersonMember));
        var mentions = new[]
        {
            new NoteMention { Type = "person", Id = "SFletcher", Name = "Sam Fletcher" },
            new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" },
        };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        var sam = Assert.Single(stored, m => m.Type == "person" && m.Id == "SFletcher");
        Assert.Null(sam.Via);   // the direct mention wins, so it still highlights in the note text
    }

    [Fact]
    public async Task CreateAsync_DedupesTheSameGroupMentionedTwice()
    {
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt", PersonMember));
        var mentions = new[]
        {
            new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" },
            new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" },
        };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        Assert.Equal(2, StoredMentions(captured).Count);   // one group row + one member
    }

    [Fact]
    public async Task CreateAsync_RejectsWhenExpansionExceedsTheCap()
    {
        var many = Enumerable.Range(1, 260)
            .Select(i => new RecapGroupMemberDto { Type = "person", Id = $"User{i}", Name = $"User {i}" })
            .ToArray();
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Everyone", many));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Everyone" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.CreateAsync(100, "b", mentions, CancellationToken.None));
        Assert.Empty(captured);
    }

    [Fact]
    public async Task CreateAsync_WithoutAGroupMention_NeverQueriesGroups()
    {
        // Ordinary notes must pay nothing for this feature.
        var (svc, _) = BuildServiceCapturingMentions(out var groups, Group(7, "Corn Belt", PersonMember));
        var mentions = new[] { new NoteMention { Type = "person", Id = "SFletcher", Name = "Sam" } };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        groups.Verify(g => g.GetAllAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateAsync_AlsoExpandsGroupMentions()
    {
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt", PersonMember));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        await svc.UpdateAsync(1, "edited", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        Assert.Equal(2, stored.Count);
        Assert.Equal("app-group:7", stored[1].Via);
    }

    [Fact]
    public void GroupMentionSerializesWithLowercaseKeys_IncludingVia()
    {
        var json = JsonSerializer.Serialize(new[]
        {
            new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" },
            new NoteMention { Type = "person", Id = "SFletcher", Name = "Sam", Email = "SFletcher@scoular.com", Via = "app-group:7" },
        });

        Assert.Contains("\"type\":\"app-group\"", json);
        Assert.Contains("\"via\":\"app-group:7\"", json);
        Assert.DoesNotContain("\"Via\"", json);
    }

    // ── Update mention semantics (null = unchanged, [] = clear) ────────────────────────────────
    // Sending no mentions used to null the column, so every edit silently destroyed a note's
    // mentions and their highlighting. The repository is now told explicitly whether to replace.

    [Fact]
    public async Task UpdateAsync_WithNullMentions_LeavesExistingMentionsUntouched()
    {
        var repo = new Mock<INoteRepository>();
        bool? replace = null;
        repo.Setup(r => r.UpdateAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<bool>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<long, string, string?, bool, string, CancellationToken>((_, _, _, r, _, _) => replace = r)
            .ReturnsAsync(new Note { Id = 1, CustomerId = 100, CreatedBy = "CEgr", Description = "b" });

        var svc = BuildServiceWith(repo);
        await svc.UpdateAsync(1, "edited", null, CancellationToken.None);

        Assert.False(replace);
    }

    [Fact]
    public async Task UpdateAsync_WithEmptyMentions_ClearsThem()
    {
        var repo = new Mock<INoteRepository>();
        bool? replace = null;
        string? json = "unset";
        repo.Setup(r => r.UpdateAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<bool>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<long, string, string?, bool, string, CancellationToken>((_, _, m, r, _, _) => { json = m; replace = r; })
            .ReturnsAsync(new Note { Id = 1, CustomerId = 100, CreatedBy = "CEgr", Description = "b" });

        var svc = BuildServiceWith(repo);
        await svc.UpdateAsync(1, "edited", [], CancellationToken.None);

        Assert.True(replace);
        Assert.Null(json);   // null column = no mentions
    }

    private static NoteService BuildServiceWith(Mock<INoteRepository> repo)
    {
        var customerRepo = new Mock<ICustomerRepository>();
        var names = new Mock<IDisplayNameLookupRepository>();
        names.Setup(n => n.ResolveAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        var ctx = new Mock<IRequestContextService>();
        ctx.Setup(c => c.GetCurrentUser()).Returns("CEgr");
        var groups = new Mock<IDailyRecapGroupService>();
        groups.Setup(g => g.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync([]);
        var entitlements = new Mock<IEntitlementsRepository>();
        entitlements.Setup(e => e.GetActiveUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyCollection<string> ids, CancellationToken _) => ids.ToHashSet(StringComparer.OrdinalIgnoreCase));
        return new NoteService(repo.Object, customerRepo.Object, names.Object, ctx.Object,
            groups.Object, entitlements.Object, new Mock<ILogger<NoteService>>().Object);
    }

    // ── Person mentions must name a real active user (H-056) ───────────────────────────────────
    // Domain validation above proves an id is INTERNAL; it never proved the person exists. Any
    // well-formed short name resolved to a real mailbox, so a hand-crafted API call (the picker
    // offers no free-typing path) could mail an authored note to any employee from the shared
    // mailbox. The id is now checked against the same active-user roster the Logic App consults.
    // Deliberately existence, NOT entitlement: mentions are intentionally not limited to the
    // caller's trade units — see SECURITY-REVIEWS/ACCEPTED-RISKS.md.

    /// <summary>Builds a service whose roster contains exactly <paramref name="activeUserIds"/>.</summary>
    private static (NoteService svc, List<string?> captured) BuildServiceWithRoster(
        params string[] activeUserIds)
    {
        var result = BuildServiceCapturingMentions(
            out Mock<IDailyRecapGroupService> _, out var entitlements);
        entitlements.Setup(e => e.GetActiveUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyCollection<string> ids, CancellationToken _) =>
                ids.Where(id => activeUserIds.Contains(id, StringComparer.OrdinalIgnoreCase))
                   .ToHashSet(StringComparer.OrdinalIgnoreCase));
        return result;
    }

    [Fact]
    public async Task CreateAsync_RejectsPersonMentionThatIsNotAnActiveUser()
    {
        var (svc, captured) = BuildServiceWithRoster("SFletcher");
        var mentions = new[] { new NoteMention { Type = "person", Id = "CEO", Name = "The Boss" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.CreateAsync(100, "Please re-approve your payroll", mentions, CancellationToken.None));
        Assert.Empty(captured);   // nothing persisted
    }

    [Fact]
    public async Task UpdateAsync_AlsoRejectsPersonMentionThatIsNotAnActiveUser()
    {
        // The edit path shares BuildMentionsJsonAsync — a note saved clean must not be editable
        // into a forged recipient afterwards.
        var (svc, captured) = BuildServiceWithRoster("SFletcher");
        var mentions = new[] { new NoteMention { Type = "person", Id = "CEO", Name = "The Boss" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.UpdateAsync(1, "edited", mentions, CancellationToken.None));
        Assert.Empty(captured);
    }

    [Theory]
    [InlineData("SFletcher")]              // bare short name, as the catalog emits it
    [InlineData("SFletcher@scoular.com")]  // full internal UPN — matched on the local part
    [InlineData("sfletcher")]              // roster lookup is case-insensitive
    public async Task CreateAsync_AcceptsPersonMentionNamingAnActiveUser(string id)
    {
        var (svc, captured) = BuildServiceWithRoster("SFletcher");
        var mentions = new[] { new NoteMention { Type = "person", Id = id, Name = "Sam Fletcher" } };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        Assert.Equal("person", stored[0].Type);
        Assert.EndsWith("@scoular.com", stored[0].Email);
    }

    [Fact]
    public async Task CreateAsync_DoesNotRevalidateGroupMembers_AgainstTheRoster()
    {
        // Group members were validated against the group creator's entitlements when the group was
        // saved (AR-07). Re-checking them here would silently narrow group mentions.
        var (svc, captured) = BuildServiceCapturingMentions(
            out Mock<IDailyRecapGroupService> _, out var entitlements, Group(7, "Corn Belt", PersonMember));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        Assert.Contains(StoredMentions(captured), m => m.Type == "person" && m.Id == "SFletcher");
        entitlements.Verify(e => e.GetActiveUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task CreateAsync_StillValidates_WhenTheClientForgesGroupProvenance()
    {
        // `via` marks a row as group-derived and therefore exempt. It is server-set, so a client
        // that sends its own must not be able to buy that exemption.
        var (svc, captured) = BuildServiceWithRoster("SFletcher");
        var mentions = new[] { new NoteMention { Type = "person", Id = "CEO", Name = "The Boss", Via = "app-group:1" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.CreateAsync(100, "b", mentions, CancellationToken.None));
        Assert.Empty(captured);
    }

    [Fact]
    public async Task CreateAsync_FailsClosed_WhenTheUserRosterCannotBeRead()
    {
        var (svc, captured) = BuildServiceCapturingMentions(
            out Mock<IDailyRecapGroupService> _, out var entitlements);
        entitlements.Setup(e => e.GetActiveUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("roster down"));
        var mentions = new[] { new NoteMention { Type = "person", Id = "SFletcher", Name = "Sam Fletcher" } };

        await Assert.ThrowsAsync<InfrastructureException>(
            () => svc.CreateAsync(100, "b", mentions, CancellationToken.None));
        Assert.Empty(captured);   // an unverifiable recipient is never persisted
    }

    [Fact]
    public async Task CreateAsync_WithoutAPersonMention_NeverQueriesTheRoster()
    {
        // The hot path — an ordinary note, or one mentioning only a trade unit — pays nothing.
        var (svc, _) = BuildServiceCapturingMentions(
            out Mock<IDailyRecapGroupService> _, out var entitlements);
        var mentions = new[] { new NoteMention { Type = "trade-unit", Id = "1084", Name = "1084" } };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        entitlements.Verify(e => e.GetActiveUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task CreateAsync_RejectsAnInactiveUser_RatherThanLettingTheSendDropThemSilently()
    {
        // The Logic App skips inactive recipients, so this note would have saved looking shared and
        // notified nobody. Same philosophy as the empty-group guard: reject, never silently drop.
        var (svc, captured) = BuildServiceWithRoster();   // roster returns nobody as active
        var mentions = new[] { new NoteMention { Type = "person", Id = "RRetired", Name = "R Retired" } };

        await Assert.ThrowsAsync<ValidationException>(
            () => svc.CreateAsync(100, "b", mentions, CancellationToken.None));
        Assert.Empty(captured);
    }

    // ── Teams groups: the app-group row IS the recipient ───────────────────────────────────────
    // Delivery method is the whole routing decision. A "teams" group posts the note to its channel
    // INSTEAD of emailing its members, so expansion must stop at the group row. The workflow
    // re-reads the channel address from DailyRecapGroups for that id at send time, which is why the
    // stored row still carries no address — the M-025 property holds for the channel exactly as it
    // does for people.

    private static RecapGroupDto ChannelGroup(int id, string name, params RecapGroupMemberDto[] members) => new()
    {
        Id = id,
        Name = name,
        DeliveryMethod = "teams",
        TeamsChannelEmail = "abcd1234.scoular.com@amer.teams.ms",
        Members = members.ToList(),
    };

    [Fact]
    public async Task CreateAsync_TeamsGroup_StoresOnlyTheGroupRow_AndExpandsNobody()
    {
        var (svc, captured) = BuildServiceCapturingMentions(
            ChannelGroup(7, "Grain Desk", PersonMember, TradeUnitMember));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Grain Desk" } };

        await svc.CreateAsync(100, "note body", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        var only = Assert.Single(stored);
        Assert.Equal("app-group", only.Type);
        Assert.Equal("7", only.Id);
        Assert.Equal("Grain Desk", only.Name);   // authoritative server-side name
        Assert.Null(only.Via);
        Assert.Null(only.Email);                 // the address is never persisted on the note
    }

    [Fact]
    public async Task CreateAsync_TeamsGroup_WithNoMembers_IsAccepted()
    {
        // The empty-group guard must not fire here: the channel is the recipient, so an entry with
        // nobody in it still notifies someone.
        var (svc, captured) = BuildServiceCapturingMentions(ChannelGroup(7, "Grain Desk"));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Grain Desk" } };

        await svc.CreateAsync(100, "note body", mentions, CancellationToken.None);

        Assert.Single(StoredMentions(captured));
    }

    [Fact]
    public async Task CreateAsync_TeamsGroup_NeverStoresTheChannelAddress_EvenIfTheClientSendsOne()
    {
        // The client cannot smuggle a destination onto the note: NormalizeMention drops email on
        // every non-person row, and the workflow reads the address from the DB regardless.
        var (svc, captured) = BuildServiceCapturingMentions(ChannelGroup(7, "Grain Desk"));
        var mentions = new[]
        {
            new NoteMention { Type = "app-group", Id = "7", Name = "Grain Desk", Email = "attacker@evil.com" }
        };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        Assert.Null(Assert.Single(StoredMentions(captured)).Email);
        Assert.DoesNotContain("evil.com", captured[0]);
    }

    [Fact]
    public async Task CreateAsync_TeamsGroup_AlongsideAPersonMention_KeepsBoth()
    {
        // Mentioning a channel and a person in one note must still notify the person — the two
        // delivery paths are independent in the workflow.
        var (svc, captured) = BuildServiceCapturingMentions(ChannelGroup(7, "Grain Desk"));
        var mentions = new[]
        {
            new NoteMention { Type = "person", Id = "SFletcher", Name = "Sam Fletcher" },
            new NoteMention { Type = "app-group", Id = "7", Name = "Grain Desk" },
        };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        Assert.Equal(2, stored.Count);
        Assert.Equal("SFletcher@scoular.com", stored[0].Email);
        Assert.Equal("app-group", stored[1].Type);
    }

    [Fact]
    public async Task CreateAsync_EmailGroup_StillExpandsItsMembers()
    {
        // Regression guard: the new branch must be reached only for Teams delivery.
        var (svc, captured) = BuildServiceCapturingMentions(Group(7, "Corn Belt", PersonMember));
        var mentions = new[] { new NoteMention { Type = "app-group", Id = "7", Name = "Corn Belt" } };

        await svc.CreateAsync(100, "b", mentions, CancellationToken.None);

        var stored = StoredMentions(captured);
        Assert.Equal(2, stored.Count);
        Assert.Equal("app-group:7", stored[1].Via);
    }
}
