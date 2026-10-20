// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Extracted verbatim from DiagnosticsController (audit finding
/// dotnet.diagnostics-controller-bypasses-service-layer). Uses the App Service managed identity
/// (or the developer's own credential locally) through <see cref="IGraphDirectoryClient"/>.
/// </summary>
public sealed class AppAccessDiagnosticsService : IAppAccessDiagnosticsService
{
    private readonly IGraphDirectoryClient _graphDirectory;
    private readonly IConfiguration _config;
    private readonly ILogger<AppAccessDiagnosticsService> _logger;

    public AppAccessDiagnosticsService(
        IGraphDirectoryClient graphDirectory,
        IConfiguration config,
        ILogger<AppAccessDiagnosticsService> logger)
    {
        _graphDirectory = graphDirectory;
        _config = config;
        _logger = logger;
    }

    public async Task<AppAccessGroupMembersResponse> GetGroupMembersAsync(CancellationToken cancellationToken)
    {
        var groupId = _config.GetValue<string>("AppAccess:GroupId")?.Trim();
        var groupName = _config.GetValue<string>("AppAccess:GroupName")?.Trim();
        if (string.IsNullOrEmpty(groupId) && string.IsNullOrEmpty(groupName))
        {
            return new AppAccessGroupMembersResponse
            {
                GroupName = string.Empty,
                Outcome = "NotConfigured",
                Detail = "Neither AppAccess:GroupId nor AppAccess:GroupName is set for this environment."
            };
        }

        // Prefer the direct object read — the scoped managed identity can read its specific
        // group(s) but cannot list/search, so the name-search path only works locally.
        var groupResult = !string.IsNullOrEmpty(groupId)
            ? await _graphDirectory.GetGroupByIdAsync(groupId, cancellationToken)
            : await _graphDirectory.FindGroupByNameAsync(groupName!, cancellationToken);
        var label = groupResult.Value?.DisplayName ?? groupName ?? groupId!;
        if (!groupResult.Ok)
        {
            return new AppAccessGroupMembersResponse
            {
                GroupName = label,
                Outcome = groupResult.Status.ToString(),
                HttpStatus = groupResult.HttpStatus,
                Detail = groupResult.Detail
            };
        }

        var membersResult = await _graphDirectory.GetGroupTransitiveUserMembersAsync(groupResult.Value!.Id, cancellationToken);
        if (!membersResult.Ok)
        {
            return new AppAccessGroupMembersResponse
            {
                GroupName = label,
                Outcome = membersResult.Status.ToString(),
                HttpStatus = membersResult.HttpStatus,
                Detail = membersResult.Detail
            };
        }

        var members = membersResult.Value!
            .OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(u => new AppAccessGroupMemberResponse
            {
                DisplayName = u.DisplayName,
                UserPrincipalName = u.UserPrincipalName,
                AccountEnabled = u.AccountEnabled
            })
            .ToList();

        // Group-scoped grant without User.ReadBasic.All: Graph returns members but strips user
        // properties. Call that out as its own outcome — it's the last step of the grant progression.
        var idOnlyCount = members.Count(m => string.IsNullOrEmpty(m.UserPrincipalName));
        if (members.Count > 0 && idOnlyCount == members.Count)
        {
            return new AppAccessGroupMembersResponse
            {
                GroupName = label,
                Outcome = "MembersIdOnly",
                HttpStatus = 200,
                Detail = $"{members.Count} members returned, but with ids only (no names/UPNs) — the identity " +
                         "also needs the User.ReadBasic.All application permission. The app matches people by " +
                         "UPN, so filtering stays OFF (fail-open) until that grant lands.",
                MemberCount = members.Count,
                Members = members
            };
        }

        _logger.LogInformation("App-access group read OK: {MemberCount} members", members.Count);
        return new AppAccessGroupMembersResponse
        {
            GroupName = label,
            Outcome = "Ok",
            HttpStatus = 200,
            Detail = idOnlyCount > 0
                ? $"{idOnlyCount} of {members.Count} members returned id-only (no UPN) and are excluded from matching."
                : null,
            MemberCount = members.Count,
            Members = members
        };
    }
}
