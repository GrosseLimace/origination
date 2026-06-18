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
        var group = new DailyRecapGroup
        {
            Name = request.Name.Trim(),
            DeliveryMethod = request.DeliveryMethod,
            TeamsChannelEmail = request.DeliveryMethod == "teams" ? request.TeamsChannelEmail?.Trim() : null,
            Enabled = true,
            CreatedBy = _requestContext.GetCurrentUser(),
            CreatedAt = DateTime.UtcNow,
            Members = BuildMembers(request),
            CcEmails = BuildCcEmails(request),
        };
        await _repository.AddAsync(group, cancellationToken);
        return MapRecapGroup(group, isOwner: true);
    }

    /// <inheritdoc />
    public async Task<RecapGroupDto?> UpdateAsync(int groupId, RecapGroupRequest request, CancellationToken cancellationToken)
    {
        var group = await _repository.UpdateAsync(
            groupId,
            _requestContext.GetCurrentUser(),
            request.Name.Trim(),
            request.DeliveryMethod,
            request.DeliveryMethod == "teams" ? request.TeamsChannelEmail?.Trim() : null,
            BuildMembers(request),
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

    /// <summary>Member email is only kept for person members (trade-unit / group members are
    /// re-resolved by the Logic App at send time).</summary>
    private static List<DailyRecapGroupMember> BuildMembers(RecapGroupRequest req) =>
        req.Members.Select(m => new DailyRecapGroupMember
        {
            MemberType = m.Type,
            MemberId = m.Id,
            MemberName = m.Name,
            Email = m.Type == "person" ? m.Email : null,
        }).ToList();

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
