using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class DailyRecapGroupService : IDailyRecapGroupService
{
    private readonly IDailyRecapGroupRepository _repository;
    private readonly IEntitlementsRepository _entitlements;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<DailyRecapGroupService> _logger;

    public DailyRecapGroupService(
        IDailyRecapGroupRepository repository,
        IEntitlementsRepository entitlements,
        IRequestContextService requestContext,
        ILogger<DailyRecapGroupService> logger)
    {
        _repository = repository;
        _entitlements = entitlements;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<RecapGroupDto>> GetAllAsync(CancellationToken cancellationToken)
    {
        var currentUser = _requestContext.GetCurrentUser();           // full UPN, matches CreatedBy
        var userId = currentUser.Contains('@') ? currentUser.Split('@')[0] : currentUser;  // prefix, matches person MemberId

        // Resolve the caller's entitlements so the read can include groups they're a MEMBER of (by
        // trade unit or trade-unit group), not just ones they created. Member ids mirror the Daily
        // Digest picker: trade-unit = TU code, trade-unit-group = entitlements GroupId (as string).
        var tuCodes = new List<string>();
        var groupIds = new List<string>();
        try
        {
            var rows = await _entitlements.GetByUserAsync(userId, cancellationToken);
            tuCodes = rows.Where(r => !string.IsNullOrWhiteSpace(r.TradeUnitCode)).Select(r => r.TradeUnitCode).Distinct().ToList();
            groupIds = rows.Where(r => r.GroupId != null).Select(r => r.GroupId!.Value.ToString()).Distinct().ToList();
        }
        catch (Exception ex)
        {
            // Entitlements unavailable → fall back to creator-owned groups only (empty member sets).
            _logger.LogWarning(ex, "Entitlements unavailable for {UserId} — recap group list limited to owned groups", userId);
        }

        var groups = await _repository.GetVisibleAsync(currentUser, userId, tuCodes, groupIds, cancellationToken);
        return groups.Select(g => MapRecapGroup(g, isOwner: g.CreatedBy == currentUser)).ToList();
    }

    /// <inheritdoc />
    public async Task<RecapGroupDto> CreateAsync(RecapGroupRequest request, CancellationToken cancellationToken)
    {
        var members = await BuildValidatedMembersAsync(request, cancellationToken);
        var group = new DailyRecapGroup
        {
            Name = request.Name.Trim(),
            DeliveryMethod = request.DeliveryMethod,
            TeamsChannelEmail = request.DeliveryMethod == "teams" ? request.TeamsChannelEmail?.Trim() : null,
            Enabled = true,
            CreatedBy = _requestContext.GetCurrentUser(),
            CreatedAt = DateTime.UtcNow,
            Members = members,
            CcEmails = BuildCcEmails(request),
        };
        await _repository.AddAsync(group, cancellationToken);
        return MapRecapGroup(group, isOwner: true);
    }

    /// <inheritdoc />
    public async Task<RecapGroupDto?> UpdateAsync(int groupId, RecapGroupRequest request, CancellationToken cancellationToken)
    {
        var members = await BuildValidatedMembersAsync(request, cancellationToken);
        var group = await _repository.UpdateAsync(
            groupId,
            _requestContext.GetCurrentUser(),
            request.Name.Trim(),
            request.DeliveryMethod,
            request.DeliveryMethod == "teams" ? request.TeamsChannelEmail?.Trim() : null,
            members,
            BuildCcEmails(request),
            cancellationToken);
        return group == null ? null : MapRecapGroup(group, isOwner: true);
    }

    /// <inheritdoc />
    public async Task<RecapGroupDto?> SetEnabledAsync(int groupId, bool enabled, CancellationToken cancellationToken)
    {
        var group = await _repository.SetEnabledAsync(groupId, _requestContext.GetCurrentUser(), enabled, cancellationToken);
        return group == null ? null : MapRecapGroup(group, isOwner: true);
    }

    /// <inheritdoc />
    public Task DeleteAsync(int groupId, CancellationToken cancellationToken) =>
        _repository.DeleteAsync(groupId, _requestContext.GetCurrentUser(), cancellationToken);

    // ── Mapping helpers ─────────────────────────────────────────────────────

    /// <summary>Builds the member rows to persist, enforcing that every member is within the caller's
    /// entitlement overlap — the same boundary the picker catalog exposes (people must share a trade
    /// unit with the caller; trade-unit / group members must be ones the caller is entitled to). A
    /// member outside that overlap is rejected (403) rather than silently dropped. Fails CLOSED: if
    /// entitlements can't be read we cannot prove scope, so the save is refused.
    ///
    /// For person members the recipient <c>Email</c> is DERIVED from the validated id (the
    /// <c>{id}@scoular.com</c> UPN convention) and never taken from the request body — an untrusted
    /// address must never reach the Logic App, which uses it both as the note-query key and the send
    /// target. (trade-unit / group members carry no email; the Logic App re-resolves them at send time.)</summary>
    private async Task<List<DailyRecapGroupMember>> BuildValidatedMembersAsync(RecapGroupRequest req, CancellationToken cancellationToken)
    {
        if (req.Members.Count == 0) return new List<DailyRecapGroupMember>();

        var caller = _requestContext.GetCurrentUserShortName();
        List<UserTradeUnitAccess> callerRows;
        try
        {
            callerRows = await _entitlements.GetByUserAsync(caller, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Entitlements unavailable validating recap members for {UserId} — rejecting save", caller);
            throw new ForbiddenException("Unable to verify recipient entitlements right now. Please try again later.");
        }

        var allowedTuCodes = callerRows
            .Select(r => r.TradeUnitCode)
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var allowedGroupIds = callerRows
            .Where(r => r.GroupId.HasValue)
            .Select(r => r.GroupId!.Value.ToString())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var allowedPeople = allowedTuCodes.Count == 0
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : (await _entitlements.GetUsersByTradeUnitsAsync(allowedTuCodes.ToList(), cancellationToken))
                .Select(u => u.UserId)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var members = new List<DailyRecapGroupMember>(req.Members.Count);
        foreach (var m in req.Members)
        {
            switch (m.Type)
            {
                case "person":
                    if (!allowedPeople.Contains(m.Id))
                        throw new ForbiddenException($"You are not entitled to include '{m.Id}' as a recipient.");
                    members.Add(new DailyRecapGroupMember
                    {
                        MemberType = m.Type,
                        MemberId = m.Id,
                        MemberName = m.Name,
                        Email = $"{m.Id}@scoular.com",
                    });
                    break;

                case "trade-unit":
                    if (!allowedTuCodes.Contains(m.Id))
                        throw new ForbiddenException($"You are not entitled to trade unit '{m.Id}'.");
                    members.Add(new DailyRecapGroupMember { MemberType = m.Type, MemberId = m.Id, MemberName = m.Name, Email = null });
                    break;

                case "trade-unit-group":
                    if (!allowedGroupIds.Contains(m.Id))
                        throw new ForbiddenException($"You are not entitled to group '{m.Id}'.");
                    members.Add(new DailyRecapGroupMember { MemberType = m.Type, MemberId = m.Id, MemberName = m.Name, Email = null });
                    break;

                default:
                    // Type is already constrained by [AllowedValues]; defensive guard for completeness.
                    throw new ValidationException(nameof(req.Members), $"Unknown member type '{m.Type}'.");
            }
        }
        return members;
    }

    private static List<DailyRecapGroupCcEmail> BuildCcEmails(RecapGroupRequest req) =>
        req.CcEmails
            .Select(e => e?.Trim() ?? string.Empty)
            .Where(e => e.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(e => new DailyRecapGroupCcEmail { Email = e })
            .ToList();

    private static RecapGroupDto MapRecapGroup(DailyRecapGroup g, bool isOwner) => new()
    {
        Id = g.Id,
        Name = g.Name,
        DeliveryMethod = g.DeliveryMethod,
        TeamsChannelEmail = g.TeamsChannelEmail,
        Enabled = g.Enabled,
        Members = g.Members
            .Select(m => new RecapGroupMemberDto { Type = m.MemberType, Id = m.MemberId, Name = m.MemberName, Email = m.Email })
            .ToList(),
        CcList = g.CcEmails.Select(c => c.Email).ToList(),
        IsOwner = isOwner,
        CreatedBy = g.CreatedBy,
    };
}
