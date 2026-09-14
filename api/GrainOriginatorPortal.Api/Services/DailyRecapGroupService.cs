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

    /// <summary>The caller's entitlement rows, fetched at most once per request (the service is
    /// scoped). Both the authorization context and new-member validation derive from this same set,
    /// so an entitlements outage produces one coherent story rather than two. Only a SUCCESSFUL
    /// fetch is cached — never a failure, which would let a transient blip in the read path poison a
    /// later write decision in the same request.</summary>
    private List<UserTradeUnitPreference>? _callerRows;

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
        var (access, _) = await GetAccessAsync(cancellationToken);
        var groups = await _repository.GetVisibleAsync(access, cancellationToken);
        // Every visible group is editable — edit rights equal visibility. IsOwner is narrower and
        // now gates delete only.
        return groups
            .Select(g => MapRecapGroup(g, isOwner: IsCreator(g, access.CallerUpn), canEdit: true))
            .ToList();
    }

    /// <inheritdoc />
    public async Task<RecapGroupDto> CreateAsync(RecapGroupRequest request, CancellationToken cancellationToken)
    {
        // No pre-existing members, so every requested member is an add and gets validated.
        var members = await BuildValidatedMembersAsync(request, [], cancellationToken);
        var group = new DailyRecapGroup
        {
            Name = request.Name.Trim(),
            DeliveryMethod = request.DeliveryMethod,
            TeamsChannelEmail = request.DeliveryMethod == "teams" ? request.TeamsChannelEmail?.Trim() : null,

            Enabled = request.Enabled,
            CreatedBy = _requestContext.GetCurrentUser(),
            CreatedAt = DateTime.UtcNow,
            Members = members,
            CcEmails = BuildCcEmails(request),
        };
        await _repository.AddAsync(group, cancellationToken);
        return MapRecapGroup(group, isOwner: true, canEdit: true);
    }

    /// <inheritdoc />
    public async Task<RecapGroupDto?> UpdateAsync(int groupId, RecapGroupRequest request, CancellationToken cancellationToken)
    {
        // AUTHORIZE FIRST, then validate. The old order (validate, then filter on CreatedBy) leaked
        // entitlement details about a group the caller could not touch, and delta validation needs
        // the persisted member set anyway.
        var (access, degraded) = await GetAccessAsync(cancellationToken);
        var existing = await _repository.GetVisibleByIdAsync(groupId, access, cancellationToken);
        if (existing == null)
            return NotVisible<RecapGroupDto>(degraded);

        var members = await BuildValidatedMembersAsync(request, existing.Members, cancellationToken);
        var values = new RecapGroupValues(
            request.Name.Trim(),
            request.DeliveryMethod,
            request.DeliveryMethod == "teams" ? request.TeamsChannelEmail?.Trim() : null,
            members,
            BuildCcEmails(request));

        var group = await _repository.UpdateAsync(groupId, access, values, cancellationToken);
        return group == null ? null : MapRecapGroup(group, isOwner: IsCreator(group, access.CallerUpn), canEdit: true);
    }

    /// <inheritdoc />
    public async Task<RecapGroupDto?> SetEnabledAsync(int groupId, bool enabled, CancellationToken cancellationToken)
    {
        var (access, degraded) = await GetAccessAsync(cancellationToken);

        // Turning the recap ON needs members: the digest is built from the notes the members can
        // see, so a memberless entry (which channel routing now permits) would schedule a nightly
        // send with nothing in it. Costs one extra read on a low-frequency toggle.
        if (enabled)
        {
            var current = await _repository.GetVisibleByIdAsync(groupId, access, cancellationToken);
            if (current == null)
                return NotVisible<RecapGroupDto>(degraded);
            if (current.Members.Count == 0)
                throw new ValidationException(nameof(RecapGroupEnabledRequest.Enabled),
                    "A group with no members cannot send a daily recap. Add members first.");
        }

        var group = await _repository.SetEnabledAsync(groupId, access, enabled, cancellationToken);
        if (group == null)
            return NotVisible<RecapGroupDto>(degraded);
        return MapRecapGroup(group, isOwner: IsCreator(group, access.CallerUpn), canEdit: true);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(int groupId, CancellationToken cancellationToken)
    {
        // Delete is the one creator-only verb, so it gets an explicit check rather than riding on a
        // query predicate — a silent no-op here used to return 204 and log a delete that never
        // happened. No entitlements lookup: membership is irrelevant to deleting.
        var callerUpn = _requestContext.GetCurrentUser();
        var group = await _repository.GetByIdAsync(groupId, cancellationToken)
            ?? throw new NotFoundException("DailyRecapGroup", groupId);

        if (!IsCreator(group, callerUpn))
            throw new ForbiddenException(
                "Only the creator of this group can delete it. You can still edit it, or remove yourself from its members.");

        // False means the row vanished between the two reads — a 404 is honest, and it keeps the
        // controller's audit line unreachable unless a delete really happened.
        if (!await _repository.DeleteAsync(groupId, callerUpn, cancellationToken))
            throw new NotFoundException("DailyRecapGroup", groupId);
    }

    // ── Caller access ───────────────────────────────────────────────────────

    /// <summary>Resolves who the caller is and what they are entitled to, for both the visibility
    /// and the edit decision. NEVER throws: on an entitlements failure it returns the creator-only
    /// context and <c>Degraded = true</c>. That is the fail-closed choice — assuming entitlement
    /// would widen the predicate to match every group (anyone could PUT any id), while throwing
    /// would lock out creators, who need no entitlements to edit their own group. Degrading can only
    /// narrow.</summary>
    private async Task<(RecapGroupAccess Access, bool Degraded)> GetAccessAsync(CancellationToken cancellationToken)
    {
        var callerUpn = _requestContext.GetCurrentUser();          // full UPN, matches CreatedBy
        var personId = _requestContext.GetCurrentUserShortName();  // UPN prefix, matches a person member's MemberId

        List<UserTradeUnitPreference> rows;
        try
        {
            rows = await LoadCallerRowsAsync(personId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Entitlements unavailable for {UserId} — recap group access limited to groups they created", personId);
            return (RecapGroupAccess.CreatorOnly(callerUpn, personId), true);
        }

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

        return (new RecapGroupAccess(callerUpn, personId, tuCodes, groupIds), false);
    }

    /// <summary>What to return when a write target did not resolve. A degraded access context only
    /// ever matches groups the caller created, so a member's legitimate edit would otherwise look
    /// like a 404 — say "try again" instead of lying about existence.</summary>
    private static T? NotVisible<T>(bool degraded) where T : class =>
        degraded
            ? throw new InfrastructureException(
                "Unable to verify your access to this group right now. Please try again later.",
                "ENTITLEMENTS_UNAVAILABLE")
            : null;

    /// <summary>Fetches the caller's entitlement rows once per request. Propagates the failure —
    /// callers decide whether to degrade (authorization) or refuse (member validation).</summary>
    private async Task<List<UserTradeUnitPreference>> LoadCallerRowsAsync(string personId, CancellationToken cancellationToken)
    {
        if (_callerRows != null) return _callerRows;
        var rows = await _entitlements.GetByUserAsync(personId, cancellationToken);
        _callerRows = rows;   // cache success only
        return rows;
    }

    /// <summary>Ordinal-ignore-case on purpose: the SQL predicate runs under a case-insensitive
    /// collation, so a plain C# <c>==</c> could tell an owner their own group is not theirs if a
    /// token ever issues <c>preferred_username</c> with different casing.</summary>
    private static bool IsCreator(DailyRecapGroup group, string callerUpn) =>
        string.Equals(group.CreatedBy, callerUpn, StringComparison.OrdinalIgnoreCase);

    // ── Mapping helpers ─────────────────────────────────────────────────────

    /// <summary>Builds the member rows to persist. Members ALREADY on the group pass through
    /// untouched; only members being ADDED are validated against the caller's entitlement overlap —
    /// the same boundary the picker catalog exposes (people must share a trade unit with the caller;
    /// trade-unit / group members must be ones the caller is entitled to). An out-of-scope addition
    /// is rejected (403) rather than silently dropped, and removals are always allowed.
    ///
    /// Validating only the delta is what makes shared editing work: re-checking every member would
    /// 403 any editor whose entitlements are narrower than the creator's, which is precisely the
    /// cross-trade-unit group people build these for. It also fixes a standing bug where a creator
    /// who LOST an entitlement could no longer even rename their own group. It opens no laundering
    /// path, because the pass-through set comes from the database, not from the request: removing and
    /// re-adding someone in one save is a no-op (the row never left), and doing it across two saves
    /// makes the second one an add, which is validated.
    ///
    /// Pass-through rows keep the STORED type / id / name so an editor cannot relabel someone else's
    /// member, and person <c>Email</c> is re-derived from the id ({id}@scoular.com) for every person
    /// member — added or not — so an untrusted address can never reach the Logic App, which uses it
    /// as both the note-query key and the send target (M-025 / M-025a).
    ///
    /// Fails CLOSED on the add path: if entitlements cannot be read we cannot prove scope, so a save
    /// that adds anything is refused. A save that only renames, removes, or edits CC needs no lookup
    /// and still succeeds.</summary>
    private async Task<List<DailyRecapGroupMember>> BuildValidatedMembersAsync(
        RecapGroupRequest req,
        IReadOnlyCollection<DailyRecapGroupMember> existing,
        CancellationToken cancellationToken)
    {
        if (req.Members.Count == 0) return [];

        // First-wins rather than ToDictionary: nothing stops duplicate (type, id) rows existing
        // today, and a cosmetic data issue should not become a 500 on every save.
        var existingByKey = new Dictionary<string, DailyRecapGroupMember>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in existing)
            existingByKey.TryAdd(MemberKey(m.MemberType, m.MemberId), m);

        // Dedupe the request the way BuildCcEmails does, and work out what is actually new before
        // spending an entitlements round trip on it.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var incoming = new List<(RecapGroupMemberRequest Request, DailyRecapGroupMember? Existing)>(req.Members.Count);
        foreach (var m in req.Members)
        {
            var key = MemberKey(m.Type, m.Id);
            if (!seen.Add(key)) continue;
            incoming.Add((m, existingByKey.GetValueOrDefault(key)));
        }

        var additions = incoming.Where(i => i.Existing == null).Select(i => i.Request).ToList();
        var scope = additions.Count == 0
            ? AdditionScope.Empty
            : await LoadAdditionScopeAsync(additions, cancellationToken);

        var members = new List<DailyRecapGroupMember>(incoming.Count);
        foreach (var (m, existingRow) in incoming)
        {
            if (existingRow != null)
            {
                // Already a member: keep the stored identity + label, re-derive the address. A NEW
                // entity, because the repository removes the old child rows before attaching these.
                members.Add(new DailyRecapGroupMember
                {
                    MemberType = existingRow.MemberType,
                    MemberId = existingRow.MemberId,
                    MemberName = existingRow.MemberName,
                    Email = existingRow.MemberType == "person" ? $"{existingRow.MemberId}@scoular.com" : null,
                });
                continue;
            }

            switch (m.Type)
            {
                case "person":
                    if (!scope.People.Contains(m.Id))
                        throw new ForbiddenException(
                            $"You are not entitled to add '{m.Id}' as a recipient. If they were already in this group, refresh the page and try again.");
                    members.Add(new DailyRecapGroupMember
                    {
                        MemberType = m.Type,
                        MemberId = m.Id,
                        MemberName = m.Name,
                        Email = $"{m.Id}@scoular.com",
                    });
                    break;

                case "trade-unit":
                    if (!scope.TradeUnitCodes.Contains(m.Id))
                        throw new ForbiddenException($"You are not entitled to trade unit '{m.Id}'.");
                    members.Add(new DailyRecapGroupMember { MemberType = m.Type, MemberId = m.Id, MemberName = m.Name, Email = null });
                    break;

                case "trade-unit-group":
                    if (!scope.GroupIds.Contains(m.Id))
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

    /// <summary>The caller's entitlement overlap, resolved only when a save actually adds members.
    /// The people lookup is skipped unless a new <c>person</c> is among them.</summary>
    private async Task<AdditionScope> LoadAdditionScopeAsync(
        List<RecapGroupMemberRequest> additions,
        CancellationToken cancellationToken)
    {
        var caller = _requestContext.GetCurrentUserShortName();
        List<UserTradeUnitPreference> callerRows;
        try
        {
            callerRows = await LoadCallerRowsAsync(caller, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Entitlements unavailable validating recap members for {UserId} — rejecting save", caller);
            throw new ForbiddenException("Unable to verify recipient entitlements right now. Please try again later.");
        }

        var tuCodes = callerRows
            .Select(r => r.TradeUnitCode)
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var groupIds = callerRows
            .Where(r => r.GroupId.HasValue)
            .Select(r => r.GroupId!.Value.ToString())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var people = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (tuCodes.Count > 0 && additions.Any(a => a.Type == "person"))
        {
            people = (await _entitlements.GetUsersByTradeUnitsAsync(tuCodes.ToList(), cancellationToken))
                .Select(u => u.UserId)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        return new AdditionScope(people, tuCodes, groupIds);
    }

    /// <summary>The caller's entitlement overlap, used only to vet members being added. All three
    /// sets are case-insensitive; <see cref="Empty"/> proves nothing and so rejects every addition.</summary>
    private sealed record AdditionScope(
        HashSet<string> People,
        HashSet<string> TradeUnitCodes,
        HashSet<string> GroupIds)
    {
        /// <summary>Used when a save adds nothing, so no entitlements lookup happens at all.</summary>
        public static AdditionScope Empty { get; } = new([], [], []);
    }

    /// <summary>Identity of a member row for delta comparison. Trimmed, and compared in C# with an
    /// explicit case-insensitive comparer rather than in SQL, so it behaves identically in tests
    /// (ordinal in-memory provider) and in production (case-insensitive collation).</summary>
    private static string MemberKey(string type, string id) => $"{type.Trim()}|{id.Trim()}";

    private static List<DailyRecapGroupCcEmail> BuildCcEmails(RecapGroupRequest req) =>
        req.CcEmails
            .Select(e => e?.Trim() ?? string.Empty)
            .Where(e => e.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(e => new DailyRecapGroupCcEmail { Email = e })
            .ToList();

    private static RecapGroupDto MapRecapGroup(DailyRecapGroup g, bool isOwner, bool canEdit) => new()
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
        CanEdit = canEdit,
        CreatedBy = g.CreatedBy,
    };
}
