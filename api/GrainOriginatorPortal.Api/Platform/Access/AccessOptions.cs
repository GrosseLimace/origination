namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>The <c>Access</c> configuration section (plan §4.3 and §7.1).</summary>
public sealed class AccessOptions
{
    public const string SectionName = "Access";

    /// <summary>
    /// Roles a signed-in person gets when their token carries no persona role, until the entitlements app
    /// issues personas. Today that is everyone, so appsettings sets <c>Originator</c> + <c>Editor</c>: what a
    /// non-admin can do now. Empty means no defaults, which is where it must be before traders launch
    /// (Phase 6). App-only tokens never get defaults.
    /// </summary>
    public string[] DefaultRoles { get; set; } = [];

    /// <summary>How long each instance keeps the grants before reloading them, so a grant change takes effect within this.</summary>
    public TimeSpan GrantCacheDuration { get; set; } = TimeSpan.FromMinutes(5);
}
