using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Exceptions;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class BidSheetService : IBidSheetService
{
    private readonly IBidSheetRepository _repository;
    private readonly IRequestContextService _requestContext;
    private readonly IUserEntitlementService _entitlementService;
    private readonly IBarchartCatalogRepository _barchartCatalog;
    private readonly IBarchartIngestRepository _barchartIngest;
    private readonly IEntitlementsRepository _entitlements;
    private readonly ILogger<BidSheetService> _logger;

    /// <summary>Resolved once per request — the service is scoped, so this lives exactly as long as the
    /// request does and several methods share the two queries behind it.</summary>
    private BidSheetAccess? _access;

    public BidSheetService(
        IBidSheetRepository repository,
        IRequestContextService requestContext,
        IUserEntitlementService entitlementService,
        IBarchartCatalogRepository barchartCatalog,
        IBarchartIngestRepository barchartIngest,
        IEntitlementsRepository entitlements,
        ILogger<BidSheetService> logger)
    {
        _repository = repository;
        _requestContext = requestContext;
        _entitlementService = entitlementService;
        _barchartCatalog = barchartCatalog;
        _barchartIngest = barchartIngest;
        _entitlements = entitlements;
        _logger = logger;
    }

    /// <summary>
    /// Who the caller is, for deciding which sheets they may see: their identity, their desks, their
    /// trade-unit groups, and the recap groups they belong to. Resolved once per request and cached for
    /// its lifetime, because several methods need it and it costs two queries.
    /// </summary>
    /// <remarks>
    /// Fails CLOSED. If entitlements or recap groups can't be read we fall back to
    /// <see cref="BidSheetAccess.OwnerAndSelfOnly"/>, which narrows the predicate to sheets the caller
    /// owns or is named on personally. That can only ever take access away -- an owner keeps working, a
    /// desk-share member is denied -- whereas assuming entitlement on failure would hand every shared
    /// sheet to everyone. Same reasoning, and the same shape, as DailyRecapGroupService.GetAccessAsync.
    /// </remarks>
    private async Task<BidSheetAccess> GetAccessAsync(CancellationToken cancellationToken)
    {
        if (_access != null) return _access;

        var callerUpn = _requestContext.GetCurrentUser();
        var personId = _requestContext.GetCurrentUserShortName();

        try
        {
            var rows = await _entitlements.GetByUserAsync(personId, cancellationToken);
            var tuCodes = rows
                .Where(r => !string.IsNullOrWhiteSpace(r.TradeUnitCode))
                .Select(r => r.TradeUnitCode)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var groupIds = rows
                .Where(r => r.GroupId.HasValue)
                .Select(r => r.GroupId!.Value.ToString())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            // The second hop: which recap groups this person is in, resolved from the desks and groups
            // above, because recap-group membership is itself people/units/groups.
            var recapGroupIds = await _repository.GetCallerRecapGroupIdsAsync(
                callerUpn, personId, tuCodes, groupIds, cancellationToken);

            _access = new BidSheetAccess(callerUpn, personId, tuCodes, groupIds, recapGroupIds);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Could not resolve bid sheet access for {UserId} — limited to sheets they own or are named on",
                personId);
            _access = BidSheetAccess.OwnerAndSelfOnly(callerUpn, personId);
        }

        return _access;
    }

    /// <summary>
    /// Authorizes a DESTRUCTIVE change to a location: only whoever created it, or an Admin.
    ///
    /// This replaced a check against the row's persisted trade unit, which stopped meaning anything
    /// when locations became company-wide -- there is no desk left to check, and without a
    /// replacement these endpoints would have had no authorization beyond being signed in.
    ///
    /// Only DESTRUCTIVE operations are gated. Entering bids, renaming and marking Scoular stay open
    /// to any signed-in user, which matches how originators work and matches AR-01's position that
    /// bid sheet records are shared rather than owned. Deleting is different in kind: one row now
    /// serves everybody, so a delete takes the elevator and its whole bid history away from every
    /// sheet at once, and there is no undo.
    ///
    /// Returns false when the location does not exist, so the caller can no-op rather than leak that
    /// through an exception. Throws ForbiddenException -- a real 403, not a 404 -- when the row
    /// exists and the caller simply may not destroy it.
    /// </summary>
    private async Task<bool> AuthorizeDestructiveLocationChangeAsync(int locationId, CancellationToken cancellationToken)
    {
        var createdBy = await _repository.GetLocationCreatedByAsync(locationId, cancellationToken);
        if (string.IsNullOrEmpty(createdBy)) return false;
        if (_requestContext.IsAdmin()) return true;

        var caller = _requestContext.GetCurrentUser();
        if (!string.Equals(createdBy, caller, StringComparison.OrdinalIgnoreCase))
            throw new ForbiddenException(
                "Only the person who added this location, or an administrator, can remove it. "
              + "It is shared, so removing it would take it off everyone's sheet.");

        return true;
    }

    /// <inheritdoc />
    public async Task<List<BidSheetLocationResponse>> GetLocationsAsync(CancellationToken cancellationToken)
    {
        var locations = await _repository.GetAllLocationsAsync(cancellationToken);
        return locations.Select(l => l.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<BidSheetLocationResponse> CreateLocationAsync(CreateBidSheetLocationRequest request, CancellationToken cancellationToken)
    {
        // Friendly guard, not a database constraint (see LocationNameExistsAsync): surface a clear
        // validation message (→ 400) rather than letting a same-named row through silently. Locations
        // are company-wide now, so this checks every location, not one desk's.
        if (await _repository.LocationNameExistsAsync(request.Name, cancellationToken))
            throw new ValidationException("name",
                $"A location named \"{request.Name.Trim()}\" already exists. Use a different name.");

        // Resolved before anything is written so a bad link fails as a 400 rather than leaving an
        // unlinked location behind.
        var barchartLocation = await ResolveBarchartLocationAsync(request, cancellationToken);

        var user = _requestContext.GetCurrentUser();
        var now = DateTime.UtcNow;
        var location = new BidSheetLocation
        {
            Name = request.Name,
            // Fall back to the vendor's record for anything the caller left blank: adding from the picker
            // sends little more than a key, and a location with no coordinates never gets a map pin.
            Address = request.Address ?? barchartLocation?.Address,
            City = request.City ?? barchartLocation?.City,
            State = request.State ?? barchartLocation?.State,
            Latitude = request.Latitude ?? barchartLocation?.Latitude,
            Longitude = request.Longitude ?? barchartLocation?.Longitude,
            ElevatorCode = request.ElevatorCode,
            // Taken from the catalog, not the request, so the stored key is always canonical.
            BarchartLocationKey = barchartLocation?.LocationKey,
            TradeUnitCode = request.TradeUnitCode,
            GroupName = request.GroupName,
            IsScoularFacility = request.IsScoularFacility,
            CreatedBy = user,
            CreatedAt = now,
            Bids = request.Bids.Select(b => new BidSheetLocationBid
            {
                CommodityCode = b.CommodityCode,
                CommodityName = b.CommodityName,
                CommodityCategory = b.CommodityCategory,
                CropYear = b.CropYear,
                Month = b.Month,
                Bid = b.Bid,
                BasisBid = string.IsNullOrWhiteSpace(b.BasisBid) ? null : b.BasisBid,
                CreatedBy = user,
                CreatedAt = now
            }).ToList()
        };

        BidSheetLocation created;
        try
        {
            created = await _repository.CreateLocationAsync(location, cancellationToken);
        }
        catch (DuplicateLocationException ex)
        {
            // The database caught a race the pre-checks above could not: two creates for the same
            // placement, which the parallel BarChart bulk add makes reachable. Answered as validation so
            // it reads identically to the serialized case.
            throw new ValidationException(nameof(request.Name), ex.Message);
        }
        if (barchartLocation is null) return created.ToResponse();

        // Publish the feed's current prices immediately, so a location added from the picker shows its
        // bids right away instead of looking empty until the next pipeline run.
        await _barchartIngest.ApplyBidsToBidSheetAsync(
            created.Id, BarchartFeedDefaults.InstrumentType, BarchartFeedDefaults.Actor,
            cancellationToken: cancellationToken);

        var withFedBids = await _repository.GetLocationAsync(created.Id, cancellationToken);
        return (withFedBids ?? created).ToResponse();
    }

    /// <summary>
    /// Validates a requested BarChart link and returns the catalog listing it points at, or null when the
    /// request isn't a feed link. Rejects unknown keys and a second link to the same location in one trade
    /// unit, which would put duplicate fed bids on the sheet.
    /// </summary>
    private async Task<BarchartLocationSummary?> ResolveBarchartLocationAsync(
        CreateBidSheetLocationRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.BarchartLocationKey)) return null;

        var key = request.BarchartLocationKey.Trim();

        if (await _repository.BarchartLocationLinkedAsync(key, cancellationToken))
            throw new ValidationException("barchartLocationKey",
                "This BarChart location is already on this trade unit's bid sheet.");

        return await _barchartCatalog.GetLocationAsync(key, cancellationToken)
            ?? throw new ValidationException("barchartLocationKey",
                "That BarChart location is no longer in the feed. Refresh the list and try again.");
    }

    /// <inheritdoc />
    public async Task<BidSheetLocationResponse?> UpdateLocationAsync(int id, CreateBidSheetLocationRequest request, CancellationToken cancellationToken)
    {
        // Open to any signed-in user: renaming, re-siting and the Scoular flag are shared-record
        // edits, not destructive ones. The repository returns null for a row that is not there, which
        // the controller turns into a 404.

        var location = new BidSheetLocation
        {
            Name = request.Name,
            Address = request.Address,
            City = request.City,
            State = request.State,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            IsScoularFacility = request.IsScoularFacility,
            ModifiedBy = _requestContext.GetCurrentUser()
        };

        var updated = await _repository.UpdateLocationAsync(id, location, cancellationToken);
        return updated?.ToResponse();
    }

    /// <inheritdoc />
    public async Task DeleteLocationAsync(int id, CancellationToken cancellationToken)
    {
        // Destructive and company-wide: creator or Admin only.
        if (!await AuthorizeDestructiveLocationChangeAsync(id, cancellationToken)) return;
        await _repository.DeleteLocationAsync(id, cancellationToken);
    }

    /// <inheritdoc />
    public async Task DeleteBidsAsync(int locationId, string commodityCode, int? month, CancellationToken cancellationToken)
    {
        // Wipes every bid for a commodity on a shared location: creator or Admin only.
        if (!await AuthorizeDestructiveLocationChangeAsync(locationId, cancellationToken)) return;
        await _repository.DeleteBidsAsync(locationId, commodityCode, month, cancellationToken);
    }

    /// <inheritdoc />
    public async Task BulkUpsertBidsAsync(List<UpsertBidSheetBidRequest> requests, CancellationToken cancellationToken)
    {
        var user = _requestContext.GetCurrentUser();
        // One transaction for the lot. This used to group by trade unit and run a batch per desk --
        // and silently DROP any group whose trade unit was blank, so a caller that stopped sending one
        // lost its bids behind a 204. Locations are company-wide now, so there is nothing to group by.
        {
            var inputs = requests.Select(r => new BidUpsertInput
            {
                LocationId = r.LocationId,
                Name = r.Name,
                ElevatorCode = r.ElevatorCode,
                GroupName = r.GroupName,
                Latitude = r.Latitude,
                Longitude = r.Longitude,
                CommodityCode = r.CommodityCode,
                CommodityName = r.CommodityName,
                CommodityCategory = r.CommodityCategory,
                CropYear = r.CropYear,
                Month = r.Month,
                Bid = r.Bid,
                BasisBid = r.BasisBid
            }).ToList();
            try
            {
                await _repository.BulkUpsertBidsAsync(inputs, user, cancellationToken);
            }
            catch (BidSheetLocationNotFoundException ex)
            {
                // Surfaced as validation so the user is told to refresh, rather than getting a 500 for
                // what is almost always a stale grid pointing at a location someone else removed.
                throw new ValidationException(nameof(UpsertBidSheetBidRequest.LocationId), ex.Message);
            }
        }
    }

    /// <inheritdoc />
    public async Task<BidSheetPreferenceResponse?> GetPreferenceAsync(string tradeUnitKey, CancellationToken cancellationToken)
    {
        var pref = await _repository.GetPreferenceAsync(_requestContext.GetCurrentUser(), tradeUnitKey, cancellationToken);
        return pref?.ToResponse();
    }

    /// <inheritdoc />
    public Task SetPreferenceAsync(string tradeUnitKey, string? cropCode, int? month, int? cropYear, string? cropOrder,
        string? hiddenCrops, string? selectedMonths, string? selectedYears, string? printLayout, string? priceMode,
        int? selectedBidSheetId, CancellationToken cancellationToken) =>
        _repository.SetPreferenceAsync(_requestContext.GetCurrentUser(), tradeUnitKey, cropCode, month, cropYear,
            cropOrder, hiddenCrops, selectedMonths, selectedYears, printLayout, priceMode, selectedBidSheetId, cancellationToken);

    // =============================================================================================
    // Sheets
    // =============================================================================================

    /// <summary>
    /// Loads a sheet the caller may READ, or throws.
    ///
    /// The distinction between 404 and 403 is deliberate. The DailyRecapGroup precedent folds both
    /// into "row not found", which tells a genuine outsider the same story as a deleted sheet -- and
    /// tells a member whose share was just revoked that their work disappeared. Asking whether the
    /// row exists costs one indexed count and makes both messages true.
    /// </summary>
    private async Task<Infrastructure.Data.Entities.BidSheet> RequireVisibleSheetAsync(int sheetId, CancellationToken cancellationToken)
    {
        var access = await GetAccessAsync(cancellationToken);
        var sheet = await _repository.GetVisibleSheetAsync(sheetId, access, cancellationToken);
        if (sheet != null) return sheet;

        if (await _repository.SheetExistsAsync(sheetId, cancellationToken))
            throw new ForbiddenException("This bid sheet has not been shared with you.");

        throw new NotFoundException("Bid sheet", sheetId);
    }

    /// <summary>
    /// Loads a sheet the caller OWNS, or throws.
    ///
    /// Rename, reshare and delete are owner-only. A member deleting the owner's sheet out from under
    /// them is the wrong default, and a member reshuffling who else can see it is worse -- both would
    /// be invisible to the owner until they next opened the picker.
    /// </summary>
    private async Task RequireSheetOwnerAsync(int sheetId, CancellationToken cancellationToken)
    {
        var owner = await _repository.GetSheetOwnerAsync(sheetId, cancellationToken);
        if (owner == null) throw new NotFoundException("Bid sheet", sheetId);

        var user = _requestContext.GetCurrentUserShortName();
        if (!string.Equals(owner, user, StringComparison.OrdinalIgnoreCase))
            throw new ForbiddenException("Only the person who created this bid sheet can rename, reshare, or delete it.");
    }

    /// <summary>Re-reads a sheet after a write so the client gets the full, ordered shape back rather
    /// than having to reload. Cheap: it is the same query the screen already runs on open.</summary>
    private async Task<BidSheetResponse> ReloadSheetAsync(int sheetId, CancellationToken cancellationToken)
    {
        var access = await GetAccessAsync(cancellationToken);
        var sheet = await _repository.GetVisibleSheetAsync(sheetId, access, cancellationToken)
            ?? throw new NotFoundException("Bid sheet", sheetId);
        return sheet.ToResponse(access.PersonId);
    }

    /// <inheritdoc />
    public async Task<List<BidSheetResponse>> GetSheetsAsync(CancellationToken cancellationToken)
    {
        var access = await GetAccessAsync(cancellationToken);
        var sheets = await _repository.GetVisibleSheetsAsync(access, cancellationToken);
        return sheets.Select(s => s.ToResponse(access.PersonId)).ToList();
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> GetSheetAsync(int sheetId, CancellationToken cancellationToken)
    {
        var sheet = await RequireVisibleSheetAsync(sheetId, cancellationToken);
        return sheet.ToResponse(_requestContext.GetCurrentUserShortName());
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> CreateSheetAsync(BidSheetRequest request, CancellationToken cancellationToken)
    {
        var user = _requestContext.GetCurrentUserShortName();
        var name = request.Name.Trim();

        if (await _repository.SheetNameExistsAsync(user, name, null, cancellationToken))
            throw new BusinessException($"You already have a bid sheet called \"{name}\".", "DUPLICATE_BID_SHEET_NAME");

        var sheet = await _repository.CreateSheetAsync(new Infrastructure.Data.Entities.BidSheet
        {
            Name = name,
            OwnerUserId = user,
            CreatedBy = user,
            CreatedAt = DateTime.UtcNow,
        }, cancellationToken);

        return sheet.ToResponse(user);
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> RenameSheetAsync(int sheetId, BidSheetRequest request, CancellationToken cancellationToken)
    {
        await RequireSheetOwnerAsync(sheetId, cancellationToken);

        var user = _requestContext.GetCurrentUserShortName();
        var name = request.Name.Trim();

        if (await _repository.SheetNameExistsAsync(user, name, sheetId, cancellationToken))
            throw new BusinessException($"You already have a bid sheet called \"{name}\".", "DUPLICATE_BID_SHEET_NAME");

        _ = await _repository.RenameSheetAsync(sheetId, name, user, cancellationToken)
            ?? throw new NotFoundException("Bid sheet", sheetId);

        return await ReloadSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> SetSheetLayoutAsync(int sheetId, BidSheetLayoutRequest request, CancellationToken cancellationToken)
    {
        // Any member. The layout is not a personal preference here -- it IS the shared view, which is
        // the point of sharing a sheet rather than a list of names.
        await RequireVisibleSheetAsync(sheetId, cancellationToken);

        var user = _requestContext.GetCurrentUserShortName();
        _ = await _repository.SetSheetLayoutAsync(sheetId, request.CropOrder, request.HiddenCrops,
                request.SelectedMonths, request.SelectedYears, user, cancellationToken)
            ?? throw new NotFoundException("Bid sheet", sheetId);

        return await ReloadSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task DeleteSheetAsync(int sheetId, CancellationToken cancellationToken)
    {
        await RequireSheetOwnerAsync(sheetId, cancellationToken);
        await _repository.DeleteSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> SetSheetSharesAsync(int sheetId, BidSheetSharesRequest request, CancellationToken cancellationToken)
    {
        await RequireSheetOwnerAsync(sheetId, cancellationToken);

        var user = _requestContext.GetCurrentUserShortName();
        var now = DateTime.UtcNow;
        // Rejected rather than silently dropped: an unknown discriminator can never grant access (the
        // visibility predicate only matches the four it knows), so storing one would put a row in the
        // share list that looks like somebody was given access and does nothing.
        var unknown = request.Members
            .Select(m => m.ResolvedMemberType)
            .FirstOrDefault(t => !BidSheetShareTypes.IsKnown(t));
        if (unknown != null)
            throw new ValidationException("members",
                $"'{unknown}' is not a kind of member a bid sheet can be shared with.");

        var shares = request.Members
            .Where(m => !string.IsNullOrWhiteSpace(m.ResolvedMemberId))
            .Select(m => new Infrastructure.Data.Entities.BidSheetShare
            {
                MemberType = m.ResolvedMemberType,
                MemberId = m.ResolvedMemberId,
                MemberName = string.IsNullOrWhiteSpace(m.Name) ? null : m.Name.Trim(),
                SharedBy = user,
                SharedAt = now,
            })
            .ToList();

        _ = await _repository.SetSheetSharesAsync(sheetId, shares, cancellationToken)
            ?? throw new NotFoundException("Bid sheet", sheetId);

        return await ReloadSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> AddSheetLocationAsync(int sheetId, AddBidSheetLocationRequest request, CancellationToken cancellationToken)
    {
        await RequireVisibleSheetAsync(sheetId, cancellationToken);

        // The location has to already exist. Adding to a sheet is a membership change, not a create --
        // the picker and the manual-add form own creating locations, and letting this path create one
        // implicitly is exactly the hole that was just closed in the bulk bid upsert.
        var location = await _repository.GetLocationAsync(request.LocationId, cancellationToken)
            ?? throw new NotFoundException("Bid sheet location", request.LocationId);

        await _repository.AddSheetLocationAsync(sheetId, location.Id, _requestContext.GetCurrentUserShortName(), cancellationToken);
        return await ReloadSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> RemoveSheetLocationAsync(int sheetId, int locationId, CancellationToken cancellationToken)
    {
        await RequireVisibleSheetAsync(sheetId, cancellationToken);
        await _repository.RemoveSheetLocationAsync(sheetId, locationId, cancellationToken);
        return await ReloadSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> RemoveSheetLocationsAsync(int sheetId, BidSheetRemoveLocationsRequest request, CancellationToken cancellationToken)
    {
        // Any member, like the single remove and like adding: taking a location off a shared sheet is
        // ordinary editing. It is NOT the destructive delete -- that one lives on the location itself,
        // is creator-or-Admin only, and warns how many sheets hold it first.
        await RequireVisibleSheetAsync(sheetId, cancellationToken);
        await _repository.RemoveSheetLocationsAsync(sheetId, request.LocationIds, cancellationToken);
        return await ReloadSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> SetSheetLocationNameAsync(int sheetId, int locationId, BidSheetLocationNameRequest request, CancellationToken cancellationToken)
    {
        var sheet = await RequireVisibleSheetAsync(sheetId, cancellationToken);
        // Blank clears the override instead of storing an empty name -- it is the only way back to the
        // canonical name. Trimmed so a whitespace-only value can't masquerade as a real rename.
        var name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name.Trim();

        // A name must be unique ON THE SHEET. The client keys grid rows, and every rename / Scoular /
        // delete lookup, by the displayed name, so two rows sharing one would send those actions to the
        // wrong location. Compared against what each row DISPLAYS (its own override, else the canonical
        // name), case-insensitively, skipping the location being renamed so renaming to its own name is
        // a no-op rather than a collision. Enforced here and not only in the client because a second
        // member, or a stale client, can rename the same sheet.
        //
        // Clearing (null) is exempt: it is the only way back to the canonical name, and refusing it
        // would leave a user unable to undo a rename.
        if (name != null)
        {
            var clash = sheet.Locations
                .Where(l => l.BidSheetLocationId != locationId && l.Location != null)
                .Select(l => l.DisplayName ?? l.Location!.Name)
                .FirstOrDefault(n => string.Equals(n, name, StringComparison.OrdinalIgnoreCase));
            if (clash != null)
                throw new ValidationException("name",
                    $"Another location on this sheet is already called \"{clash}\".");
        }

        await _repository.SetSheetLocationNameAsync(sheetId, locationId, name, cancellationToken);
        return await ReloadSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BidSheetResponse> SetSheetLocationOrderAsync(int sheetId, BidSheetLocationOrderRequest request, CancellationToken cancellationToken)
    {
        await RequireVisibleSheetAsync(sheetId, cancellationToken);
        await _repository.SetSheetLocationOrderAsync(sheetId, request.LocationIds, cancellationToken);
        return await ReloadSheetAsync(sheetId, cancellationToken);
    }

    /// <inheritdoc />
    public Task<int> CountSheetsHoldingLocationAsync(int locationId, CancellationToken cancellationToken)
        => _repository.CountSheetsHoldingLocationAsync(locationId, cancellationToken);
}
