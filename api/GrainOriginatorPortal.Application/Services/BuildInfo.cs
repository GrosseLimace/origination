using System.Reflection;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Identifies the build the process is running, read once from assembly attributes.
/// <para>
/// Directory.Build.props sets SourceRevisionId from GITHUB_SHA and adds an AssemblyMetadata item
/// for the workflow run number. The SDK appends the revision to InformationalVersion as
/// "+&lt;sha&gt;", which is where CommitSha reads it back from.
/// </para>
/// <para>
/// On a developer machine the SDK still fills SourceRevisionId from the local git checkout, so
/// the commit is reported there too. Only the run number falls back to "local", because it has
/// no local equivalent.
/// </para>
/// </summary>
public static class BuildInfo
{
    /// <summary>Reported when there is nothing to report — see <see cref="BuildNumber"/>.</summary>
    public const string Local = "local";

    /// <summary>Full git SHA the assembly was built from, or "local" outside a git checkout.</summary>
    public static string CommitSha { get; } = ReadCommitSha();

    /// <summary>First seven characters of <see cref="CommitSha"/>, for display.</summary>
    public static string ShortSha { get; } =
        CommitSha.Length > 7 ? CommitSha[..7] : CommitSha;

    /// <summary>The GitHub Actions run number that produced this build, or "local".</summary>
    public static string BuildNumber { get; } = ReadBuildNumber();

    private static string ReadCommitSha()
    {
        var informational = typeof(BuildInfo).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        // The SDK formats this as "<version>+<sha>" when SourceRevisionId is set. Without it the
        // attribute is just the version, so there is no "+" and nothing to report.
        var plus = informational?.IndexOf('+') ?? -1;
        if (informational is null || plus < 0 || plus == informational.Length - 1)
            return Local;

        return informational[(plus + 1)..];
    }

    private static string ReadBuildNumber()
    {
        var value = typeof(BuildInfo).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "BuildNumber")
            ?.Value;

        return string.IsNullOrWhiteSpace(value) ? Local : value;
    }
}
