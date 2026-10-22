using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The sheet write paths, against a real database because every one of them is about a constraint or a
/// concurrent write that an in-memory provider does not have.
///
/// Three behaviours here exist specifically because the shapes they replaced failed silently:
///
/// * <b>Row order.</b> The old order was a per-user JSON array of location ids with no foreign key, and
///   the client dropped ids it did not recognise. So if a colleague added a row after you loaded, your
///   next drag silently removed it from the saved order. The link rows keep unmentioned locations at
///   the end instead.
/// * <b>Double add.</b> Two people picking the same elevator at the same moment hit the unique index.
///   That is the outcome they both wanted, so it resolves to the winning row rather than an error.
/// * <b>Deleting a location.</b> The link FK is RESTRICT, so only the delete path itself may clear
///   links, and only after the user has been shown how many sheets hold the elevator.
///
/// Excluded from CI by the <c>Category=Integration</c> filter. Every test rolls back.
/// </summary>
[Trait("Category", "Integration")]
[Collection("Database")]
public class BidSheetRepositorySheetTests : IAsyncLifetime
{
    private ApplicationDbContext _context = null!;
    private IDbContextTransaction _transaction = null!;
    private BidSheetRepository _sut = null!;

    private const string Owner = "__ITOwner";
    private const string Member = "__ITMember";

    private static string? ConnectionString =>
        Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");

    private static bool Enabled => !string.IsNullOrWhiteSpace(ConnectionString);

    public async Task InitializeAsync()
    {
        if (!Enabled) return;

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlServer(ConnectionString!)
            .Options;

        _context = new ApplicationDbContext(options);
        _transaction = await _context.Database.BeginTransactionAsync();
        _sut = new BidSheetRepository(_context, NullLogger<BidSheetRepository>.Instance);
    }

    public async Task DisposeAsync()
    {
        if (!Enabled) return;

        await _transaction.RollbackAsync();
        await _transaction.DisposeAsync();
        await _context.DisposeAsync();
    }

    private async Task<BidSheet> NewSheetAsync(string? owner = null)
    {
        var sheet = new BidSheet
        {
            Name = $"__IT Sheet {Guid.NewGuid():N}",
            OwnerUserId = owner ?? Owner,
            CreatedBy = owner ?? Owner,
            CreatedAt = DateTime.UtcNow,
        };
        _context.BidSheets.Add(sheet);
        await _context.SaveChangesAsync();
        return sheet;
    }

    private async Task<int> NewLocationAsync()
    {
        var loc = new BidSheetLocation
        {
            Name = $"__IT Loc {Guid.NewGuid():N}",
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow,
        };
        _context.BidSheetLocations.Add(loc);
        await _context.SaveChangesAsync();
        return loc.Id;
    }

    /// <summary>A caller who is only themselves: no desk, group or recap-group membership. Keeps these
    /// tests about the person arm of the predicate, which is the one they were written for.</summary>
    private static BidSheetAccess AccessFor(string personId) =>
        BidSheetAccess.OwnerAndSelfOnly($"{personId}@scoular.com", personId);

    private async Task<List<int>> OrderedLocationIdsAsync(int sheetId) =>
        await _context.BidSheetLocationLinks.AsNoTracking()
            .Where(l => l.BidSheetId == sheetId)
            .OrderBy(l => l.SortOrder)
            .Select(l => l.BidSheetLocationId)
            .ToListAsync();

    // =========================================================================
    // Visibility
    // =========================================================================

    // Owner sees it, the person it is shared with sees it, nobody else does. One predicate, so if it
    // is wrong it is wrong for every read on the screen.
    [Fact]
    public async Task GetVisibleSheets_ReturnsOwnedAndSharedOnly()
    {
        if (!Enabled) return;

        var mine = await NewSheetAsync();
        var shared = await NewSheetAsync(owner: "__ITSomeoneElse");
        await _sut.SetSheetSharesAsync(shared.Id,
            [new BidSheetShare { MemberId = Owner, SharedBy = "__ITSomeoneElse", SharedAt = DateTime.UtcNow }], default);
        var theirs = await NewSheetAsync(owner: "__ITSomeoneElse");

        var visible = await _sut.GetVisibleSheetsAsync(AccessFor(Owner), default);
        var ids = visible.Select(s => s.Id).ToHashSet();

        Assert.Contains(mine.Id, ids);
        Assert.Contains(shared.Id, ids);
        Assert.DoesNotContain(theirs.Id, ids);
    }

    // Each of the four share kinds, against the real predicate. These are the tests that matter most in
    // this file: the predicate decides who may READ and EDIT a sheet, and getting it wrong widens access
    // silently rather than failing, so every arm is exercised and every one is also checked NEGATIVELY.
    [Fact]
    public async Task GetVisibleSheets_MatchesEachKindOfShare_AndNothingElse()
    {
        if (!Enabled) return;

        var byPerson = await NewSheetAsync(owner: "__ITSomeoneElse");
        var byDesk = await NewSheetAsync(owner: "__ITSomeoneElse");
        var byTuGroup = await NewSheetAsync(owner: "__ITSomeoneElse");
        var byRecap = await NewSheetAsync(owner: "__ITSomeoneElse");
        var unshared = await NewSheetAsync(owner: "__ITSomeoneElse");

        await ShareAsync(byPerson, BidSheetShareTypes.Person, Owner);
        await ShareAsync(byDesk, BidSheetShareTypes.TradeUnit, "__IT2190");
        await ShareAsync(byTuGroup, BidSheetShareTypes.TradeUnitGroup, "__ITGRP7");
        await ShareAsync(byRecap, BidSheetShareTypes.RecapGroup, "__ITRECAP9");
        // Same ids under the WRONG type must not match -- that is what the type column is for.
        await ShareAsync(unshared, BidSheetShareTypes.Person, "__IT2190");

        var access = new BidSheetAccess($"{Owner}@scoular.com", Owner,
            ["__IT2190"], ["__ITGRP7"], ["__ITRECAP9"]);
        var ids = (await _sut.GetVisibleSheetsAsync(access, default)).Select(s => s.Id).ToHashSet();

        Assert.Contains(byPerson.Id, ids);
        Assert.Contains(byDesk.Id, ids);
        Assert.Contains(byTuGroup.Id, ids);
        Assert.Contains(byRecap.Id, ids);
        Assert.DoesNotContain(unshared.Id, ids);
    }

    // The fail-closed fallback. OwnerAndSelfOnly carries no desk, group or recap membership, so a sheet
    // shared with the caller's DESK must disappear while one naming them personally survives. This is
    // what makes degrading on an entitlements outage safe: it can only ever take access away.
    [Fact]
    public async Task GetVisibleSheets_DegradedAccess_KeepsPersonalSharesAndDropsDeskShares()
    {
        if (!Enabled) return;

        var byPerson = await NewSheetAsync(owner: "__ITSomeoneElse");
        var byDesk = await NewSheetAsync(owner: "__ITSomeoneElse");
        var mine = await NewSheetAsync();
        await ShareAsync(byPerson, BidSheetShareTypes.Person, Owner);
        await ShareAsync(byDesk, BidSheetShareTypes.TradeUnit, "__IT2190");

        var ids = (await _sut.GetVisibleSheetsAsync(AccessFor(Owner), default)).Select(s => s.Id).ToHashSet();

        Assert.Contains(mine.Id, ids);      // owner arm is unaffected
        Assert.Contains(byPerson.Id, ids);  // named personally
        Assert.DoesNotContain(byDesk.Id, ids);
    }

    // A desk share means the AUDIENCE moves with entitlements -- somebody who joins 2190 tomorrow gets
    // the sheet without anyone editing it. That is the deliberate trade-off of resolving on read, so it
    // is worth pinning: the same sheet, two different callers, decided only by what they are entitled to.
    [Fact]
    public async Task GetVisibleSheets_DeskShare_FollowsWhoeverIsOnThatDesk()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync(owner: "__ITSomeoneElse");
        await ShareAsync(sheet, BidSheetShareTypes.TradeUnit, "__IT2190");

        var onDesk = new BidSheetAccess($"{Member}@scoular.com", Member, ["__IT2190"], [], []);
        var offDesk = new BidSheetAccess($"{Member}@scoular.com", Member, ["__IT9999"], [], []);

        Assert.NotNull(await _sut.GetVisibleSheetAsync(sheet.Id, onDesk, default));
        Assert.Null(await _sut.GetVisibleSheetAsync(sheet.Id, offDesk, default));
    }

    /// <summary>Adds one share of a given kind, bypassing SetSheetSharesAsync so a test can write an
    /// arbitrary type/id pair directly.</summary>
    private async Task ShareAsync(BidSheet sheet, string memberType, string memberId)
    {
        _context.BidSheetShares.Add(new BidSheetShare
        {
            BidSheetId = sheet.Id,
            MemberType = memberType,
            MemberId = memberId,
            SharedBy = "__ITSomeoneElse",
            SharedAt = DateTime.UtcNow,
        });
        await _context.SaveChangesAsync();
        _context.ChangeTracker.Clear();
    }
    // =========================================================================
    // Row order
    // =========================================================================

    // The whole point of a per-sheet name: locations are company-wide, so renaming one on YOUR sheet
    // must not reach anyone else's. Two sheets holding the same location, renamed on one only.
    [Fact]
    public async Task SetSheetLocationName_RenamesOnOneSheetAndLeavesTheOtherAlone()
    {
        if (!Enabled) return;

        var mine = await NewSheetAsync();
        var theirs = await NewSheetAsync();
        var locationId = await NewLocationAsync();
        await _sut.AddSheetLocationAsync(mine.Id, locationId, Owner, default);
        await _sut.AddSheetLocationAsync(theirs.Id, locationId, Member, default);
        var canonical = (await _context.BidSheetLocations.FindAsync(locationId))!.Name;

        await _sut.SetSheetLocationNameAsync(mine.Id, locationId, "My Own Label", default);

        Assert.Equal("My Own Label", await LinkDisplayNameAsync(mine.Id, locationId));
        Assert.Null(await LinkDisplayNameAsync(theirs.Id, locationId));
        // And the shared row itself is untouched -- it is what the map and the BarChart bridge use.
        _context.ChangeTracker.Clear();
        Assert.Equal(canonical, (await _context.BidSheetLocations.FindAsync(locationId))!.Name);
    }

    // Blank clears the override. It is the only way back to the canonical name, so it must store NULL
    // rather than an empty string -- an empty name would render as a blank row.
    [Fact]
    public async Task SetSheetLocationName_ClearsTheOverrideWhenGivenNull()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var locationId = await NewLocationAsync();
        await _sut.AddSheetLocationAsync(sheet.Id, locationId, Owner, default);
        await _sut.SetSheetLocationNameAsync(sheet.Id, locationId, "Temporary", default);

        await _sut.SetSheetLocationNameAsync(sheet.Id, locationId, null, default);

        Assert.Null(await LinkDisplayNameAsync(sheet.Id, locationId));
    }

    private async Task<string?> LinkDisplayNameAsync(int sheetId, int locationId)
    {
        _context.ChangeTracker.Clear();
        var link = await _context.BidSheetLocationLinks.AsNoTracking()
            .FirstAsync(l => l.BidSheetId == sheetId && l.BidSheetLocationId == locationId);
        return link.DisplayName;
    }

    // Removing locations from a sheet must NEVER touch the locations themselves -- they are company-
    // wide and other sheets hold them. This is the test that would catch a cascade being loosened.
    [Fact]
    public async Task RemoveSheetLocations_UnlinksFromThisSheetOnly_AndKeepsTheLocations()
    {
        if (!Enabled) return;

        var mine = await NewSheetAsync();
        var theirs = await NewSheetAsync();
        var a = await NewLocationAsync();
        var b = await NewLocationAsync();
        var c = await NewLocationAsync();
        foreach (var id in new[] { a, b, c }) await _sut.AddSheetLocationAsync(mine.Id, id, Owner, default);
        await _sut.AddSheetLocationAsync(theirs.Id, a, Member, default);

        var removed = await _sut.RemoveSheetLocationsAsync(mine.Id, [a, b], default);

        Assert.Equal(2, removed);
        Assert.Equal([c], await OrderedLocationIdsAsync(mine.Id));
        // The other sheet still holds A ...
        Assert.Equal([a], await OrderedLocationIdsAsync(theirs.Id));
        // ... and every location row survives, ready to be added back.
        _context.ChangeTracker.Clear();
        foreach (var id in new[] { a, b, c })
            Assert.NotNull(await _context.BidSheetLocations.FindAsync(id));
    }

    // A stale client can send an id that has already been removed, or one from another sheet. Ignoring
    // those beats failing the whole batch and leaving the user unsure what happened.
    [Fact]
    public async Task RemoveSheetLocations_IgnoresIdsNotOnTheSheet()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var onSheet = await NewLocationAsync();
        var elsewhere = await NewLocationAsync();
        await _sut.AddSheetLocationAsync(sheet.Id, onSheet, Owner, default);

        var removed = await _sut.RemoveSheetLocationsAsync(sheet.Id, [onSheet, elsewhere, 999999], default);

        Assert.Equal(1, removed);
        Assert.Empty(await OrderedLocationIdsAsync(sheet.Id));
    }

    // An empty selection is a no-op, not a "remove everything" -- the UI disables the button, this is
    // the backstop behind it.
    [Fact]
    public async Task RemoveSheetLocations_EmptyList_RemovesNothing()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var id = await NewLocationAsync();
        await _sut.AddSheetLocationAsync(sheet.Id, id, Owner, default);

        Assert.Equal(0, await _sut.RemoveSheetLocationsAsync(sheet.Id, [], default));
        Assert.Equal([id], await OrderedLocationIdsAsync(sheet.Id));
    }
    // The order is stored as positions on link rows, so it reads back exactly as sent.
    [Fact]
    public async Task SetSheetLocationOrder_AppliesTheGivenOrder()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var a = await NewLocationAsync();
        var b = await NewLocationAsync();
        var c = await NewLocationAsync();
        foreach (var id in new[] { a, b, c })
            await _sut.AddSheetLocationAsync(sheet.Id, id, Owner, default);

        await _sut.SetSheetLocationOrderAsync(sheet.Id, [c, a, b], default);

        Assert.Equal([c, a, b], await OrderedLocationIdsAsync(sheet.Id));
    }

    // The case the old JSON order got wrong. A client that loaded before a colleague added a row sends
    // an order that does not mention it; the row must survive at the end, not vanish.
    [Fact]
    public async Task SetSheetLocationOrder_KeepsUnmentionedLocationsAtTheEnd()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var a = await NewLocationAsync();
        var b = await NewLocationAsync();
        var addedByColleague = await NewLocationAsync();
        foreach (var id in new[] { a, b, addedByColleague })
            await _sut.AddSheetLocationAsync(sheet.Id, id, Owner, default);

        // Stale client: only knows about a and b.
        await _sut.SetSheetLocationOrderAsync(sheet.Id, [b, a], default);

        Assert.Equal([b, a, addedByColleague], await OrderedLocationIdsAsync(sheet.Id));
    }

    // An id for a location that is not on this sheet is ignored rather than creating a phantom row.
    [Fact]
    public async Task SetSheetLocationOrder_IgnoresLocationsNotOnTheSheet()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var onSheet = await NewLocationAsync();
        var elsewhere = await NewLocationAsync();
        await _sut.AddSheetLocationAsync(sheet.Id, onSheet, Owner, default);

        await _sut.SetSheetLocationOrderAsync(sheet.Id, [elsewhere, onSheet], default);

        Assert.Equal([onSheet], await OrderedLocationIdsAsync(sheet.Id));
    }

    // =========================================================================
    // Adding
    // =========================================================================

    // Idempotent: two people adding the same elevator get one row, not a unique-index error and not a
    // duplicate row rendering the location twice in the grid.
    [Fact]
    public async Task AddSheetLocation_IsIdempotent()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var locationId = await NewLocationAsync();

        var first = await _sut.AddSheetLocationAsync(sheet.Id, locationId, Owner, default);
        var second = await _sut.AddSheetLocationAsync(sheet.Id, locationId, Member, default);

        Assert.Equal(first.Id, second.Id);
        Assert.Equal([locationId], await OrderedLocationIdsAsync(sheet.Id));
        // First writer keeps the attribution; the second add changed nothing.
        Assert.Equal(Owner, second.AddedBy);
    }

    // New locations land at the end of the existing order rather than at position 0.
    [Fact]
    public async Task AddSheetLocation_AppendsAfterExistingRows()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var a = await NewLocationAsync();
        var b = await NewLocationAsync();

        await _sut.AddSheetLocationAsync(sheet.Id, a, Owner, default);
        await _sut.AddSheetLocationAsync(sheet.Id, b, Owner, default);

        Assert.Equal([a, b], await OrderedLocationIdsAsync(sheet.Id));
    }

    // =========================================================================
    // Sharing
    // =========================================================================

    // The owner is never stored as a share. They already see the sheet, and a row for them would read
    // in the share list as if they had been invited to something they created.
    [Fact]
    public async Task SetSheetShares_DropsTheOwnerAndDeDuplicatesCaseInsensitively()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();

        await _sut.SetSheetSharesAsync(sheet.Id,
        [
            new BidSheetShare { MemberId = Owner,             SharedBy = Owner, SharedAt = DateTime.UtcNow },
            new BidSheetShare { MemberId = Member,            SharedBy = Owner, SharedAt = DateTime.UtcNow },
            new BidSheetShare { MemberId = Member.ToUpper(),  SharedBy = Owner, SharedAt = DateTime.UtcNow },
        ], default);

        var stored = await _context.BidSheetShares.AsNoTracking()
            .Where(sh => sh.BidSheetId == sheet.Id)
            .Select(sh => sh.MemberId)
            .ToListAsync();

        Assert.Equal([Member], stored);
    }

    // Replacing wholesale is how a share is revoked, so an empty list has to actually clear the table.
    [Fact]
    public async Task SetSheetShares_EmptyListUnsharesTheSheet()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        await _sut.SetSheetSharesAsync(sheet.Id,
            [new BidSheetShare { MemberId = Member, SharedBy = Owner, SharedAt = DateTime.UtcNow }], default);

        await _sut.SetSheetSharesAsync(sheet.Id, [], default);

        Assert.Empty(await _context.BidSheetShares.AsNoTracking().Where(sh => sh.BidSheetId == sheet.Id).ToListAsync());
        Assert.Null(await _sut.GetVisibleSheetAsync(sheet.Id, AccessFor(Member), default));
    }

    // =========================================================================
    // Names
    // =========================================================================

    // The unique index is per owner, so two people may each have a "West Desk".
    [Fact]
    public async Task SheetNameExists_IsScopedToTheOwner()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();

        Assert.True(await _sut.SheetNameExistsAsync(Owner, sheet.Name, null, default));
        Assert.False(await _sut.SheetNameExistsAsync(Member, sheet.Name, null, default));
        // Excluding itself is what lets a rename keep the same name.
        Assert.False(await _sut.SheetNameExistsAsync(Owner, sheet.Name, sheet.Id, default));
    }

    // =========================================================================
    // Deleting
    // =========================================================================

    // Deleting a sheet takes its shares and links. The locations are company-wide and must survive --
    // a cascade in the wrong direction here would delete elevators off everybody else's sheets.
    [Fact]
    public async Task DeleteSheet_RemovesSharesAndLinksButNotTheLocations()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var locationId = await NewLocationAsync();
        await _sut.AddSheetLocationAsync(sheet.Id, locationId, Owner, default);
        await _sut.SetSheetSharesAsync(sheet.Id,
            [new BidSheetShare { MemberId = Member, SharedBy = Owner, SharedAt = DateTime.UtcNow }], default);

        await _sut.DeleteSheetAsync(sheet.Id, default);

        Assert.False(await _sut.SheetExistsAsync(sheet.Id, default));
        Assert.Empty(await _context.BidSheetLocationLinks.AsNoTracking().Where(l => l.BidSheetId == sheet.Id).ToListAsync());
        Assert.Empty(await _context.BidSheetShares.AsNoTracking().Where(sh => sh.BidSheetId == sheet.Id).ToListAsync());
        Assert.NotNull(await _sut.GetLocationAsync(locationId, default));
    }

    // The count behind the delete confirmation. It counts SHEETS, not links, so a location on one
    // sheet twice (which the unique index prevents, but still) would not inflate the warning.
    [Fact]
    public async Task CountSheetsHoldingLocation_CountsDistinctSheets()
    {
        if (!Enabled) return;

        var locationId = await NewLocationAsync();
        Assert.Equal(0, await _sut.CountSheetsHoldingLocationAsync(locationId, default));

        var one = await NewSheetAsync();
        var two = await NewSheetAsync();
        await _sut.AddSheetLocationAsync(one.Id, locationId, Owner, default);
        await _sut.AddSheetLocationAsync(two.Id, locationId, Owner, default);

        Assert.Equal(2, await _sut.CountSheetsHoldingLocationAsync(locationId, default));
    }

    // Deleting a location clears its links in the same transaction. The FK is RESTRICT, so without
    // this the delete would fail outright once anyone had put the elevator on a sheet.
    [Fact]
    public async Task DeleteLocation_TakesItOffEverySheetThatHeldIt()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        var other = await NewSheetAsync(owner: "__ITSomeoneElse");
        var locationId = await NewLocationAsync();
        var survivor = await NewLocationAsync();
        await _sut.AddSheetLocationAsync(sheet.Id, locationId, Owner, default);
        await _sut.AddSheetLocationAsync(sheet.Id, survivor, Owner, default);
        await _sut.AddSheetLocationAsync(other.Id, locationId, "__ITSomeoneElse", default);

        await _sut.DeleteLocationAsync(locationId, default);

        Assert.Null(await _sut.GetLocationAsync(locationId, default));
        Assert.Equal(0, await _sut.CountSheetsHoldingLocationAsync(locationId, default));
        // The rest of the sheet is untouched.
        Assert.Equal([survivor], await OrderedLocationIdsAsync(sheet.Id));
    }

    // Removing a location from one sheet must not touch it on another. This is the difference between
    // "take it off my list" and "delete it for the company", and they are one click apart in the UI.
    [Fact]
    public async Task RemoveSheetLocation_LeavesTheLocationAndOtherSheetsAlone()
    {
        if (!Enabled) return;

        var mine = await NewSheetAsync();
        var theirs = await NewSheetAsync(owner: "__ITSomeoneElse");
        var locationId = await NewLocationAsync();
        await _sut.AddSheetLocationAsync(mine.Id, locationId, Owner, default);
        await _sut.AddSheetLocationAsync(theirs.Id, locationId, "__ITSomeoneElse", default);

        await _sut.RemoveSheetLocationAsync(mine.Id, locationId, default);

        Assert.Empty(await OrderedLocationIdsAsync(mine.Id));
        Assert.Equal([locationId], await OrderedLocationIdsAsync(theirs.Id));
        Assert.NotNull(await _sut.GetLocationAsync(locationId, default));
    }

    // =========================================================================
    // Layout
    // =========================================================================

    // The screen saves crop order, hidden crops, months and years on four separate interactions, so a
    // partial save must leave the other three alone. Blanking them would reset a colleague's view.
    [Fact]
    public async Task SetSheetLayout_NullFieldsLeaveTheStoredValueAlone()
    {
        if (!Enabled) return;

        var sheet = await NewSheetAsync();
        await _sut.SetSheetLayoutAsync(sheet.Id, "[\"YC\"]", "[\"SOR\"]", "[0,12]", "[2026]", Owner, default);

        await _sut.SetSheetLayoutAsync(sheet.Id, null, null, "[0,9]", null, Member, default);

        var stored = await _context.BidSheets.AsNoTracking().FirstAsync(s => s.Id == sheet.Id);
        Assert.Equal("[\"YC\"]", stored.CropOrder);
        Assert.Equal("[\"SOR\"]", stored.HiddenCrops);
        Assert.Equal("[0,9]", stored.SelectedMonths);
        Assert.Equal("[2026]", stored.SelectedYears);
        Assert.Equal(Member, stored.ModifiedBy);
    }
}
