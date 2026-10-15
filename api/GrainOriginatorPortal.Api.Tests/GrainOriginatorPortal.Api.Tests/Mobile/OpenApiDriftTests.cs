// System namespaces
using System.Reflection;
using System.Text.RegularExpressions;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;

// Project namespaces
using GrainOriginatorPortal.Mobile.Controllers;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>
/// openapi/mobile/specification.yaml is what Data Integrations imports into APIM: it IS the allow-list of
/// operations reachable from the internet. This test keeps that file and the mobile controllers equal
/// in both directions, so "the APIM allow-list equals the mobile surface" is a checked fact.
/// <para>
/// The spec is read with a deliberately small line-based parser (paths are 2-space-indented keys under
/// <c>paths:</c>, methods are 4-space-indented keys under a path) rather than a YAML dependency; the
/// file is ours and Redocly lints its structure in CI.
/// </para>
/// </summary>
public class OpenApiDriftTests
{
    private static readonly Regex PathLine = new(@"^  (/[^\s:]*):\s*$", RegexOptions.Compiled);
    private static readonly Regex MethodLine = new(@"^    (get|post|put|patch|delete):\s*$", RegexOptions.Compiled);
    private static readonly Regex RouteConstraint = new(@"\{([^}:]+):[^}]+\}", RegexOptions.Compiled);

    [Fact]
    public void Spec_And_MobileControllers_ExposeTheSameOperations()
    {
        var spec = ReadSpecOperations();
        var code = ReadControllerOperations();

        var onlyInSpec = spec.Except(code).OrderBy(x => x).ToList();
        var onlyInCode = code.Except(spec).OrderBy(x => x).ToList();

        Assert.True(onlyInSpec.Count == 0 && onlyInCode.Count == 0,
            "openapi/mobile/specification.yaml and the api/mobile/v1 controllers have drifted." +
            (onlyInSpec.Count > 0 ? $"\n  In the spec but not in code: {string.Join("; ", onlyInSpec)}" : string.Empty) +
            (onlyInCode.Count > 0 ? $"\n  In code but not in the spec: {string.Join("; ", onlyInCode)}" : string.Empty));
    }

    [Fact]
    public void Spec_ContainsOnlyTheEntraSecurityScheme()
    {
        var lines = File.ReadAllLines(SpecPath());
        var start = Array.FindIndex(lines, l => l.TrimEnd() == "  securitySchemes:");
        Assert.True(start >= 0, "securitySchemes section missing");

        var schemes = lines.Skip(start + 1)
            .TakeWhile(l => l.StartsWith("    ", StringComparison.Ordinal))
            .Where(l => Regex.IsMatch(l, @"^    [A-Za-z][A-Za-z0-9_]*:\s*$"))
            .Select(l => l.Trim().TrimEnd(':'))
            .ToList();

        Assert.Equal(["entraId"], schemes);
    }

    internal static HashSet<string> ReadSpecOperations()
    {
        var operations = new HashSet<string>(StringComparer.Ordinal);
        string? currentPath = null;
        var inPaths = false;

        foreach (var raw in File.ReadAllLines(SpecPath()))
        {
            var line = raw.TrimEnd();
            if (line == "paths:") { inPaths = true; continue; }
            if (inPaths && line.Length > 0 && !line.StartsWith(' ')) { inPaths = false; }
            if (!inPaths) continue;

            var path = PathLine.Match(line);
            if (path.Success) { currentPath = path.Groups[1].Value; continue; }

            var method = MethodLine.Match(line);
            if (method.Success && currentPath is not null)
            {
                operations.Add($"{method.Groups[1].Value.ToUpperInvariant()} {currentPath}");
            }
        }

        Assert.NotEmpty(operations);
        return operations;
    }

    internal static HashSet<string> ReadControllerOperations()
    {
        var operations = new HashSet<string>(StringComparer.Ordinal);

        foreach (var controller in MobileSurfaceConventionTests.MobileControllers())
        {
            var prefix = controller.GetCustomAttribute<RouteAttribute>(inherit: false)?.Template ?? string.Empty;

            foreach (var action in controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                foreach (var http in action.GetCustomAttributes<HttpMethodAttribute>())
                {
                    var template = Combine(prefix, http.Template);
                    var relative = template.StartsWith(MobileControllerBase.RoutePrefix, StringComparison.Ordinal)
                        ? template[MobileControllerBase.RoutePrefix.Length..]
                        : "/" + template;
                    relative = RouteConstraint.Replace(relative, "{$1}");
                    if (!relative.StartsWith('/')) relative = "/" + relative;

                    foreach (var verb in http.HttpMethods)
                    {
                        operations.Add($"{verb.ToUpperInvariant()} {relative}");
                    }
                }
            }
        }

        Assert.NotEmpty(operations);
        return operations;
    }

    private static string Combine(string prefix, string? template)
    {
        if (string.IsNullOrEmpty(template)) return prefix;
        if (template.StartsWith('/')) return template.TrimStart('/');
        return prefix.TrimEnd('/') + "/" + template;
    }

    internal static string SpecPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            // openapi/specification.yaml (root) is the BarChart ingestion contract; the mobile contract
            // lives one level down. Pointing at the root would diff the wrong API.
            var candidate = Path.Combine(dir.FullName, "openapi", "mobile", "specification.yaml");
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException("openapi/mobile/specification.yaml not found above " + AppContext.BaseDirectory);
    }
}
