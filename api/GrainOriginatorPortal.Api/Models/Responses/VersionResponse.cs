namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Identifies exactly which build is running, so a bug report can be tied to a deploy.
/// <para>
/// Two different notions of "version" are combined here. <see cref="ReleaseVersion"/> is the
/// human release number authored in Content/whats-new.json — what users see in the What's New
/// panel. <see cref="CommitSha"/> and <see cref="BuildNumber"/> are stamped by CI at build time
/// (see Directory.Build.props) and identify the exact commit and workflow run. On a developer
/// machine nothing is stamped and both read "local".
/// </para>
/// </summary>
public class VersionResponse
{
    /// <summary>The newest release in the release notes, or null when none are published.</summary>
    public string? ReleaseVersion { get; set; }

    /// <summary>The date of that release, or null when none are published.</summary>
    public DateOnly? ReleasedOn { get; set; }

    /// <summary>Full 40-character git SHA the assembly was built from, or "local".</summary>
    public string CommitSha { get; set; } = string.Empty;

    /// <summary>First seven characters of <see cref="CommitSha"/>, for display.</summary>
    public string ShortSha { get; set; } = string.Empty;

    /// <summary>The GitHub Actions run number that produced this build, or "local".</summary>
    public string BuildNumber { get; set; } = string.Empty;

    /// <summary>The ASP.NET Core environment name (Development / Dev / QA / Production).</summary>
    public string Environment { get; set; } = string.Empty;
}
