// Project namespaces
using System.Text.RegularExpressions;

namespace GrainOriginatorPortal.Api.Tests.Infrastructure;

/// <summary>
/// Keeps the §8 DEVIATION comment in this project's .csproj truthful.
/// </summary>
/// <remarks>
/// The comment lists every test file that still uses the banned <c>.UseInMemoryDatabase</c>
/// package, so the package cannot be removed before those files are migrated. It is maintained by
/// hand and drifted twice: it named 2 files when 7 used the package, and after being corrected to
/// 7 it named 7 when 17 did. Both times the comment's own text asked for updates in lockstep with
/// new usages, and both times that did not happen. So this test does the comparison instead: a new
/// usage, or a migrated file, now has to be acknowledged in the comment in the same change.
/// </remarks>
public class InMemoryDatabaseDeviationTests
{
    private const string ProjectFile = "GrainOriginatorPortal.Api.Tests.csproj";
    private const string Marker = "Files (one per line, path relative to this project):";

    [Fact]
    public void TheCsprojDeviationCommentNamesExactlyTheFilesThatUseInMemoryDatabase()
    {
        var projectDir = FindProjectDirectory();

        var named = FilesNamedInTheComment(Path.Combine(projectDir, ProjectFile));
        var actual = FilesCallingUseInMemoryDatabase(projectDir);

        var unlisted = actual.Except(named).Order().ToList();
        var stale = named.Except(actual).Order().ToList();

        Assert.True(unlisted.Count == 0 && stale.Count == 0,
            "The §8 DEVIATION comment in " + ProjectFile + " is out of date." +
            (unlisted.Count > 0 ? "\n  Using .UseInMemoryDatabase but NOT named in the comment:\n    " + string.Join("\n    ", unlisted) : "") +
            (stale.Count > 0 ? "\n  Named in the comment but NO LONGER using it (migrated? delete the line):\n    " + string.Join("\n    ", stale) : "") +
            "\n  Update the file list in the comment in this same change.");
    }

    private static HashSet<string> FilesNamedInTheComment(string csprojPath)
    {
        var text = File.ReadAllText(csprojPath);
        var start = text.IndexOf(Marker, StringComparison.Ordinal);
        Assert.True(start >= 0, "The §8 DEVIATION comment, or its '" + Marker + "' line, is missing from " + ProjectFile + ".");
        var end = text.IndexOf("-->", start, StringComparison.Ordinal);
        var block = text.Substring(start + Marker.Length, end - start - Marker.Length);

        return block.Split('\n')
            .Select(l => l.Trim())
            .Where(l => l.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            .Select(Normalize)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static HashSet<string> FilesCallingUseInMemoryDatabase(string projectDir)
    {
        var pattern = new Regex(@"\.UseInMemoryDatabase\s*\(", RegexOptions.Compiled);
        return Directory.EnumerateFiles(projectDir, "*.cs", SearchOption.AllDirectories)
            .Where(p => !p.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar)
                     && !p.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar))
            .Where(p => pattern.IsMatch(File.ReadAllText(p)))
            .Select(p => Normalize(Path.GetRelativePath(projectDir, p)))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static string Normalize(string relativePath) => relativePath.Replace('\\', '/');

    private static string FindProjectDirectory()
    {
        // Walk up from the test output folder to the folder holding this project's .csproj.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, ProjectFile)))
            dir = dir.Parent;
        if (dir is null) throw new InvalidOperationException("Could not locate " + ProjectFile + " above " + AppContext.BaseDirectory);
        return dir.FullName;
    }
}
