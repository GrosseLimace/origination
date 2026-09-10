// Third-party namespaces
using Microsoft.Extensions.Logging.Abstractions;

using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Authorization and identity rules for bid sheets — the shareable working sets of locations that
/// replaced the trade unit as the thing deciding what the Bid Sheet screen shows.
///
/// Two rules carry the weight and both are easy to get quietly wrong:
///
/// 1. <b>404 and 403 are different answers.</b> The DailyRecapGroup family this copies folds both into
///    "row not found", which tells a genuine outsider the same story as a deleted sheet. These pin the
///    split, because a single visibility predicate would pass a happy-path test either way.
///
/// 2. <b>Editing the contents is not the same permission as owning the sheet.</b> Any member may add
///    locations, reorder rows and change the shared layout; only the owner may rename, reshare or
///    delete. A guard applied one method too widely locks members out of the whole point of sharing;
///    one method too narrowly lets a member delete the owner's sheet.
///
/// Identity is the third trap: sheets key on the SHORT UPN ("CEgr"), while this service's location
/// paths use the full one. Mixing them makes every sheet invisible to its own owner.
/// </summary>
public class BidSheetServiceSheetsTests
{
    private readonly Mock<IBidSheetRepository> _repo = new();
    private readonly Mock<IRequestContextService> _requestContext = new();
    private readonly Mock<IUserEntitlementService> _entitlementService = new();
    private readonly Mock<IBarchartCatalogRepository> _barchartCatalog = new();
    private readonly Mock<IBarchartIngestRepository> _barchartIngest = new();
    private readonly Mock<IEntitlementsRepository> _entitlements = new();
    private readonly BidSheetService _sut;

    private const string Owner = "CEgr";
    private const string Member = "JDoe";
    private const string Outsider = "XRay";

    public BidSheetServiceSheetsTests()
    {
        _requestContext.Setup(r => r.GetCurrentUser()).Returns("CEgr@scoular.com");
        _requestContext.Setup(r => r.GetCurrentUserShortName()).Returns(Owner);
        _sut = new BidSheetService(
            _repo.Object, _requestContext.Object, _entitlementService.Object,
            _barchartCatalog.Object, _barchartIngest.Object,
            _entitlements.Object, NullLogger<BidSheetService>.Instance);
    }

    private void CallerIs(string shortName) =>
        _requestContext.Setup(r => r.GetCurrentUserShortName()).Returns(shortName);

    private static BidSheet Sheet(int id = 7, string owner = Owner, params string[] sharedWith) => new()
    {
        Id = id,
        Name = "West Desk",
        OwnerUserId = owner,
        CreatedBy = owner,
        CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
        Shares = sharedWith.Select(u => new BidSheetShare { BidSheetId = id, MemberId = u, SharedBy = owner }).ToList(),
    };

    /// <summary>The repository's visibility predicate, mirrored so a test can say who can see what.</summary>
    private void SheetIsVisibleTo(BidSheet sheet, params string[] users)
    {
        _repo.Setup(r => r.SheetExistsAsync(sheet.Id, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _repo.Setup(r => r.GetSheetOwnerAsync(sheet.Id, It.IsAny<CancellationToken>())).ReturnsAsync(sheet.OwnerUserId);
        _repo.Setup(r => r.GetVisibleSheetAsync(sheet.Id, It.IsAny<BidSheetAccess>(), It.IsAny<CancellationToken>()))
            // Matches on PersonId, the arm of the predicate these tests are about (403-vs-404 and
            // owner gating). The desk / group / recap-group arms are covered in
            // BidSheetRepositorySheetTests, against a real database where the predicate actually runs.
            .ReturnsAsync((int _, BidSheetAccess access, CancellationToken _) =>
                users.Contains(access.PersonId, StringComparer.OrdinalIgnoreCase) ? sheet : null);
    }

    // =========================================================================
    // 404 vs 403
    // =========================================================================

    // A sheet id nobody owns is genuinely missing — 404.
    [Fact]
    public async Task GetSheetAsync_SheetDoesNotExist_Throws404NotFound()
    {
        _repo.Setup(r => r.GetVisibleSheetAsync(99, It.IsAny<BidSheetAccess>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((BidSheet?)null);
        _repo.Setup(r => r.SheetExistsAsync(99, It.IsAny<CancellationToken>())).ReturnsAsync(false);

        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetSheetAsync(99, CancellationToken.None));
    }

    // A real sheet that simply is not yours is a 403, NOT a 404. Reporting "not found" would tell a
    // member whose share was just revoked that their work was deleted.
    [Fact]
    public async Task GetSheetAsync_SheetExistsButNotShared_Throws403Forbidden()
    {
        var sheet = Sheet();
        SheetIsVisibleTo(sheet, Owner);
        CallerIs(Outsider);

        var ex = await Assert.ThrowsAsync<ForbiddenException>(() => _sut.GetSheetAsync(sheet.Id, CancellationToken.None));
        Assert.Contains("not been shared", ex.Message);
    }

    // =========================================================================
    // Owner-only: rename, reshare, delete
    // =========================================================================

    // A member can edit the sheet's contents but must not be able to delete the sheet itself.
    [Fact]
    public async Task DeleteSheetAsync_CallerIsMemberNotOwner_Throws403_AndDoesNotDelete()
    {
        var sheet = Sheet(sharedWith: Member);
        SheetIsVisibleTo(sheet, Owner, Member);
        CallerIs(Member);

        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.DeleteSheetAsync(sheet.Id, CancellationToken.None));
        _repo.Verify(r => r.DeleteSheetAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeleteSheetAsync_CallerIsOwner_Deletes()
    {
        var sheet = Sheet();
        SheetIsVisibleTo(sheet, Owner);

        await _sut.DeleteSheetAsync(sheet.Id, CancellationToken.None);
        _repo.Verify(r => r.DeleteSheetAsync(sheet.Id, It.IsAny<CancellationToken>()), Times.Once);
    }

    // Resharing is owner-only for a reason a member-visible test would miss: a member quietly adding
    // or dropping people would be invisible to the owner until they next opened the share dialog.
    [Fact]
    public async Task SetSheetSharesAsync_CallerIsMemberNotOwner_Throws403_AndDoesNotWrite()
    {
        var sheet = Sheet(sharedWith: Member);
        SheetIsVisibleTo(sheet, Owner, Member);
        CallerIs(Member);

        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.SetSheetSharesAsync(
            sheet.Id, new BidSheetSharesRequest { Members = [new BidSheetShareRequest { UserId = Outsider }] },
            CancellationToken.None));

        _repo.Verify(r => r.SetSheetSharesAsync(It.IsAny<int>(), It.IsAny<List<BidSheetShare>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RenameSheetAsync_CallerIsMemberNotOwner_Throws403_AndDoesNotRename()
    {
        var sheet = Sheet(sharedWith: Member);
        SheetIsVisibleTo(sheet, Owner, Member);
        CallerIs(Member);

        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.RenameSheetAsync(
            sheet.Id, new BidSheetRequest { Name = "Theirs Now" }, CancellationToken.None));

        _repo.Verify(r => r.RenameSheetAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // =========================================================================
    // Any member: layout, locations, order
    // =========================================================================

    // The shared layout IS the point of sharing a sheet — a member must be able to change it. If the
    // owner guard were applied here, sharing would produce a read-only copy, which is the SavedLists
    // behaviour this design deliberately rejected.
    [Fact]
    public async Task SetSheetLayoutAsync_CallerIsMemberNotOwner_Saves()
    {
        var sheet = Sheet(sharedWith: Member);
        SheetIsVisibleTo(sheet, Owner, Member);
        CallerIs(Member);
        _repo.Setup(r => r.SetSheetLayoutAsync(sheet.Id, It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(sheet);

        var result = await _sut.SetSheetLayoutAsync(sheet.Id,
            new BidSheetLayoutRequest { CropOrder = "[\"YC\"]" }, CancellationToken.None);

        Assert.Equal(sheet.Id, result.Id);
        _repo.Verify(r => r.SetSheetLayoutAsync(sheet.Id, "[\"YC\"]", null, null, null, Member, It.IsAny<CancellationToken>()), Times.Once);
    }

    // Same for row order — a reorder by one member is meant to be seen by the other.
    [Fact]
    public async Task SetSheetLocationOrderAsync_CallerIsMemberNotOwner_Saves()
    {
        var sheet = Sheet(sharedWith: Member);
        SheetIsVisibleTo(sheet, Owner, Member);
        CallerIs(Member);

        await _sut.SetSheetLocationOrderAsync(sheet.Id,
            new BidSheetLocationOrderRequest { LocationIds = [3, 1, 2] }, CancellationToken.None);

        _repo.Verify(r => r.SetSheetLocationOrderAsync(sheet.Id,
            It.Is<IReadOnlyList<int>>(ids => ids.SequenceEqual(new[] { 3, 1, 2 })), It.IsAny<CancellationToken>()), Times.Once);
    }

    // An outsider must not be able to reorder a sheet they cannot see.
    [Fact]
    public async Task SetSheetLocationOrderAsync_CallerIsOutsider_Throws403_AndDoesNotWrite()
    {
        var sheet = Sheet();
        SheetIsVisibleTo(sheet, Owner);
        CallerIs(Outsider);

        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.SetSheetLocationOrderAsync(
            sheet.Id, new BidSheetLocationOrderRequest { LocationIds = [1] }, CancellationToken.None));

        _repo.Verify(r => r.SetSheetLocationOrderAsync(It.IsAny<int>(), It.IsAny<IReadOnlyList<int>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // =========================================================================
    // Adding a location is a membership change, never a create
    // =========================================================================

    // The location has to already exist. Letting this path create one implicitly is exactly the hole
    // that was closed in the bulk bid upsert, where a typo'd name forked a new company-wide row.
    [Fact]
    public async Task AddSheetLocationAsync_LocationDoesNotExist_Throws404_AndDoesNotLink()
    {
        var sheet = Sheet();
        SheetIsVisibleTo(sheet, Owner);
        _repo.Setup(r => r.GetLocationAsync(404, It.IsAny<CancellationToken>())).ReturnsAsync((BidSheetLocation?)null);

        await Assert.ThrowsAsync<NotFoundException>(() => _sut.AddSheetLocationAsync(
            sheet.Id, new AddBidSheetLocationRequest { LocationId = 404 }, CancellationToken.None));

        _repo.Verify(r => r.AddSheetLocationAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AddSheetLocationAsync_ExistingLocation_LinksAttributedToCaller()
    {
        var sheet = Sheet(sharedWith: Member);
        SheetIsVisibleTo(sheet, Owner, Member);
        CallerIs(Member);
        _repo.Setup(r => r.GetLocationAsync(12, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BidSheetLocation { Id = 12, Name = "BELMONT" });
        _repo.Setup(r => r.AddSheetLocationAsync(sheet.Id, 12, Member, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BidSheetLocationLink { BidSheetId = sheet.Id, BidSheetLocationId = 12, AddedBy = Member });

        await _sut.AddSheetLocationAsync(sheet.Id, new AddBidSheetLocationRequest { LocationId = 12 }, CancellationToken.None);

        _repo.Verify(r => r.AddSheetLocationAsync(sheet.Id, 12, Member, It.IsAny<CancellationToken>()), Times.Once);
    }

    // =========================================================================
    // Create: identity and duplicate names
    // =========================================================================

    // The owner must be stamped with the SHORT UPN. The full one would make the sheet invisible to its
    // own creator, because the visibility predicate compares against the short form.
    [Fact]
    public async Task CreateSheetAsync_StampsShortUpnAsOwner_NotFullUpn()
    {
        _repo.Setup(r => r.SheetNameExistsAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        BidSheet? captured = null;
        _repo.Setup(r => r.CreateSheetAsync(It.IsAny<BidSheet>(), It.IsAny<CancellationToken>()))
            .Callback<BidSheet, CancellationToken>((s, _) => captured = s)
            .ReturnsAsync((BidSheet s, CancellationToken _) => s);

        var result = await _sut.CreateSheetAsync(new BidSheetRequest { Name = "  West Desk  " }, CancellationToken.None);

        Assert.NotNull(captured);
        Assert.Equal(Owner, captured!.OwnerUserId);
        Assert.Equal(Owner, captured.CreatedBy);
        Assert.DoesNotContain("@", captured.OwnerUserId);
        // Trimmed, so " West Desk " and "West Desk" are the same name to the unique index.
        Assert.Equal("West Desk", captured.Name);
        // And the caller is told it is theirs, so the client can enable rename/share/delete.
        Assert.True(result.IsOwner);
    }

    // A friendly 409 rather than a unique-index violation surfacing as a 500.
    [Fact]
    public async Task CreateSheetAsync_DuplicateNameForSameOwner_Throws409_AndDoesNotInsert()
    {
        _repo.Setup(r => r.SheetNameExistsAsync(Owner, "West Desk", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var ex = await Assert.ThrowsAsync<BusinessException>(() =>
            _sut.CreateSheetAsync(new BidSheetRequest { Name = "West Desk" }, CancellationToken.None));

        Assert.Equal(409, ex.HttpStatusCode);
        Assert.Contains("West Desk", ex.Message);
        _repo.Verify(r => r.CreateSheetAsync(It.IsAny<BidSheet>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // Renaming a sheet to its own current name must not trip the duplicate check on itself.
    [Fact]
    public async Task RenameSheetAsync_ExcludesItselfFromTheDuplicateCheck()
    {
        var sheet = Sheet();
        SheetIsVisibleTo(sheet, Owner);
        _repo.Setup(r => r.SheetNameExistsAsync(Owner, "West Desk", sheet.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _repo.Setup(r => r.RenameSheetAsync(sheet.Id, "West Desk", Owner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(sheet);

        await _sut.RenameSheetAsync(sheet.Id, new BidSheetRequest { Name = "West Desk" }, CancellationToken.None);

        _repo.Verify(r => r.SheetNameExistsAsync(Owner, "West Desk", sheet.Id, It.IsAny<CancellationToken>()), Times.Once);
    }

    // =========================================================================
    // IsOwner on the way out
    // =========================================================================

    // The client greys rename/share/delete off this flag, so a member must never see it true.
    [Fact]
    public async Task GetSheetsAsync_IsOwnerReflectsTheCallerNotTheRow()
    {
        var mine = Sheet(1);
        var theirs = Sheet(2, owner: Member, sharedWith: Owner);
        _repo.Setup(r => r.GetVisibleSheetsAsync(It.IsAny<BidSheetAccess>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([mine, theirs]);

        var result = await _sut.GetSheetsAsync(CancellationToken.None);

        Assert.True(result.Single(s => s.Id == 1).IsOwner);
        Assert.False(result.Single(s => s.Id == 2).IsOwner);
    }

    // Sharing is stored as a short UPN too, and the display name captured alongside it.
    [Fact]
    public async Task SetSheetSharesAsync_MapsRequestToShareRowsAttributedToTheOwner()
    {
        var sheet = Sheet();
        SheetIsVisibleTo(sheet, Owner);
        List<BidSheetShare>? captured = null;
        _repo.Setup(r => r.SetSheetSharesAsync(sheet.Id, It.IsAny<List<BidSheetShare>>(), It.IsAny<CancellationToken>()))
            .Callback<int, List<BidSheetShare>, CancellationToken>((_, sh, _) => captured = sh)
            .ReturnsAsync(sheet);

        await _sut.SetSheetSharesAsync(sheet.Id, new BidSheetSharesRequest
        {
            Members =
            [
                new BidSheetShareRequest { UserId = " JDoe ", Name = " Jane Doe " },
                new BidSheetShareRequest { UserId = "   " },
            ]
        }, CancellationToken.None);

        Assert.NotNull(captured);
        var only = Assert.Single(captured!);
        Assert.Equal(Member, only.MemberId);
        Assert.Equal("Jane Doe", only.MemberName);
        Assert.Equal(Owner, only.SharedBy);
    }

    // =========================================================================
    // Per-sheet names: unique on the sheet
    // =========================================================================

    private static BidSheetLocationLink Link(int locationId, string canonical, string? displayName = null) => new()
    {
        BidSheetLocationId = locationId,
        DisplayName = displayName,
        Location = new BidSheetLocation { Id = locationId, Name = canonical },
    };

    // Names are identity on the client (grid rows are tracked by name; every rename / Scoular / delete
    // lookup resolves through the displayed name), so the server refuses a duplicate rather than trusting
    // the client's own check. Compared against what each row DISPLAYS, trimmed and case-insensitively --
    // here the other row's override, not its canonical name.
    [Fact]
    public async Task SetSheetLocationName_RejectsANameAnotherLocationOnTheSheetAlreadyShows()
    {
        var sheet = Sheet();
        sheet.Locations = [Link(1, "Alpha"), Link(2, "Beta", displayName: "My Beta")];
        SheetIsVisibleTo(sheet, Owner);

        var ex = await Assert.ThrowsAsync<ValidationException>(() => _sut.SetSheetLocationNameAsync(
            sheet.Id, 1, new BidSheetLocationNameRequest { Name = "  my beta " }, CancellationToken.None));

        Assert.Contains("My Beta", ex.Message);
        Assert.True(ex.Errors.ContainsKey("name"));
        _repo.Verify(r => r.SetSheetLocationNameAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // A row that was never renamed still SHOWS its canonical name, so that counts too.
    [Fact]
    public async Task SetSheetLocationName_RejectsAnotherLocationsCanonicalName()
    {
        var sheet = Sheet();
        sheet.Locations = [Link(1, "Alpha"), Link(2, "Beta")];
        SheetIsVisibleTo(sheet, Owner);

        await Assert.ThrowsAsync<ValidationException>(() => _sut.SetSheetLocationNameAsync(
            sheet.Id, 1, new BidSheetLocationNameRequest { Name = "BETA" }, CancellationToken.None));

        _repo.Verify(r => r.SetSheetLocationNameAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // The location being renamed is excluded from the comparison, so renaming it to the name it already
    // shows is a no-op write rather than a collision with itself -- and a genuinely new name goes through.
    [Fact]
    public async Task SetSheetLocationName_AllowsItsOwnNameAndAUniqueOne()
    {
        var sheet = Sheet();
        sheet.Locations = [Link(1, "Alpha", displayName: "Mine"), Link(2, "Beta")];
        SheetIsVisibleTo(sheet, Owner);

        await _sut.SetSheetLocationNameAsync(sheet.Id, 1, new BidSheetLocationNameRequest { Name = "mine" }, CancellationToken.None);
        await _sut.SetSheetLocationNameAsync(sheet.Id, 1, new BidSheetLocationNameRequest { Name = "Gamma" }, CancellationToken.None);

        _repo.Verify(r => r.SetSheetLocationNameAsync(sheet.Id, 1, "mine", It.IsAny<CancellationToken>()), Times.Once);
        _repo.Verify(r => r.SetSheetLocationNameAsync(sheet.Id, 1, "Gamma", It.IsAny<CancellationToken>()), Times.Once);
    }

    // Clearing is the only way back to the canonical name, so it is never refused -- even where the
    // canonical name it falls back to matches another row. Refusing would trap the user.
    [Fact]
    public async Task SetSheetLocationName_AlwaysAllowsClearingTheOverride()
    {
        var sheet = Sheet();
        sheet.Locations = [Link(1, "Alpha", displayName: "Renamed"), Link(2, "Beta", displayName: "Alpha")];
        SheetIsVisibleTo(sheet, Owner);

        await _sut.SetSheetLocationNameAsync(sheet.Id, 1, new BidSheetLocationNameRequest { Name = "  " }, CancellationToken.None);

        _repo.Verify(r => r.SetSheetLocationNameAsync(sheet.Id, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }
}
