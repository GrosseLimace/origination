// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

/// <summary>
/// Keeps the client's <c>PermissionId</c> type in step with <see cref="AppPermissions"/>, so a template
/// or route that names a permission the API doesn't know fails to compile.
/// </summary>
/// <remarks>
/// To regenerate the client file after changing the catalog, run from the repository root in bash:
/// <code>REGENERATE_PERMISSION_IDS=1 dotnet test --filter PermissionIdsTypeScriptTests</code>
/// </remarks>
public class PermissionIdsTypeScriptTests
{
    private const string RegenerateVariable = "REGENERATE_PERMISSION_IDS";

    private static readonly string[] ClientFile =
        ["client", "src", "app", "core", "access", "permission-ids.generated.ts"];

    /// <summary>The file's content for the current catalog, with LF line endings.</summary>
    private static string Render() =>
        "// Generated from AppPermissions.cs by PermissionIdsTypeScriptTests. Don't edit by hand.\n" +
        "// To regenerate after changing the catalog, run from the repository root in bash:\n" +
        $"//   {RegenerateVariable}=1 dotnet test --filter PermissionIdsTypeScriptTests\n" +
        "\n" +
        "/** A permission the API checks, in resource:action[:scope] form. */\n" +
        "export type PermissionId =\n" +
        string.Concat(AppPermissions.All.Select(p => $"  | '{p}'\n")).TrimEnd('\n') + ";\n";

    [Fact]
    public void TheClientsPermissionIds_MatchTheCatalog()
    {
        var path = Path.Combine([RepositoryRoot(), .. ClientFile]);
        var expected = Render();

        if (Environment.GetEnvironmentVariable(RegenerateVariable) == "1")
        {
            File.WriteAllText(path, expected);
        }

        // Git may check the file out with CRLF line endings on Windows.
        var actual = File.Exists(path) ? File.ReadAllText(path).ReplaceLineEndings("\n") : "(missing)";
        Assert.True(actual == expected,
            $"{string.Join('/', ClientFile)} doesn't match AppPermissions. From the repository root, run: " +
            $"{RegenerateVariable}=1 dotnet test --filter PermissionIdsTypeScriptTests");
    }

    [Fact]
    public void TheRenderedType_ListsEveryPermissionOnce_InCatalogOrder()
    {
        var listed = Render().Split('\n')
            .Where(line => line.StartsWith("  | '", StringComparison.Ordinal))
            .Select(line => line[5..line.LastIndexOf('\'')])
            .ToArray();

        Assert.Equal(AppPermissions.All, listed);
    }

    private static string RepositoryRoot()
    {
        // Walk up from the test output folder to the folder holding the solution.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "GrainOriginatorPortal.sln")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("Could not locate the repository root.");
    }
}
