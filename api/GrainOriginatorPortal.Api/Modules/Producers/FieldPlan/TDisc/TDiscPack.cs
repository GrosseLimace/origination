using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.TDisc;

/// <summary>
/// One USDA T-DISC version's data: the implements (mixing efficiency and depth), which implements each
/// tillage window allows, USDA's operation lookup and the designation limits, extracted from USDA's
/// workbook by tools/tdisc-extract, plus the Excel-confirmed test cases. Packs are embedded in the
/// assembly as <c>TDisc/v&lt;version&gt;/&lt;file&gt;.json</c> (see the .csproj and docs/45z/README.md).
/// Loading checks every data file against the SHA-256 recorded in the pack's manifest, as FdCicPack does.
/// </summary>
public sealed record TDiscPack
{
    private const string ResourcePrefix = "TDisc/v";

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public required TDiscManifest Manifest { get; init; }
    public required IReadOnlyDictionary<string, TDiscImplement> Implements { get; init; }
    public required IReadOnlyList<TDiscWindow> Windows { get; init; }
    public required IReadOnlyList<TDiscOperation> Operations { get; init; }
    public required TDiscRules Rules { get; init; }
    public required TDiscGoldenCases Golden { get; init; }

    public string Version => Manifest.Version;
    public string Label => Manifest.Label;

    /// <summary>The versions embedded in this assembly, e.g. "1.1.1".</summary>
    public static IReadOnlyList<string> EmbeddedVersions(Assembly? assembly = null) =>
        ResourceNames(assembly ?? typeof(TDiscPack).Assembly).Keys
            .Where(name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal) && name.EndsWith("/manifest.json", StringComparison.Ordinal))
            .Select(name => name[ResourcePrefix.Length..^"/manifest.json".Length])
            .Order(StringComparer.Ordinal)
            .ToList();

    /// <summary>Loads and verifies an embedded pack. Throws <see cref="InvalidDataException"/> when the
    /// pack is missing, incomplete, or a file's hash does not match its manifest.</summary>
    public static TDiscPack LoadEmbedded(string version, Assembly? assembly = null)
    {
        assembly ??= typeof(TDiscPack).Assembly;
        var resources = ResourceNames(assembly);
        string folder = $"{ResourcePrefix}{version}/";

        byte[] Read(string file)
        {
            if (!resources.TryGetValue(folder + file, out var actualName))
                throw new InvalidDataException($"T-DISC v{version} pack has no {file}. Confirm the pack folder exists under Content/TDisc.");
            using var stream = assembly.GetManifestResourceStream(actualName)!;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            return buffer.ToArray();
        }

        var manifest = Deserialize<TDiscManifest>(Read("manifest.json"), "manifest.json");
        if (manifest.Version != version)
            throw new InvalidDataException($"T-DISC pack folder v{version} holds a manifest for v{manifest.Version}.");

        T Verified<T>(string file)
        {
            var bytes = Read(file);
            if (!manifest.Files.TryGetValue(file, out var expectedHash))
                throw new InvalidDataException($"T-DISC v{version} manifest has no hash for {file}.");
            var actualHash = Convert.ToHexStringLower(SHA256.HashData(bytes));
            if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException(
                    $"T-DISC v{version} {file} does not match its manifest hash. Pack files must only be written by tools/tdisc-extract.");
            return Deserialize<T>(bytes, file);
        }

        var implements = Verified<ImplementsFile>("implements.json").Rows
            .Select(r => new TDiscImplement(r[0].GetString()!, r[1].GetDouble(), r[2].GetDouble()))
            .ToDictionary(i => i.Name, StringComparer.Ordinal);
        var operations = Verified<OperationsFile>("operations.json").Rows
            .Select(r => new TDiscOperation(r[0].GetString()!, r[1].Deserialize<string[]>(Json)!))
            .ToList();
        return new TDiscPack
        {
            Manifest = manifest,
            Implements = implements,
            Windows = Verified<TDiscWindow[]>("windows.json"),
            Operations = operations,
            Rules = Verified<TDiscRules>("rules.json"),
            // Test cases are written by hand (passes) and by golden.mjs (Excel's results), so they carry no
            // manifest hash; the gate checks they were confirmed against this pack's workbook.
            Golden = Deserialize<TDiscGoldenCases>(Read("golden-cases.json"), "golden-cases.json"),
        };
    }

    // Resource names use "\" or "/" after the version folder depending on the build OS (see the .csproj).
    private static Dictionary<string, string> ResourceNames(Assembly assembly) =>
        assembly.GetManifestResourceNames().ToDictionary(n => n.Replace('\\', '/'), n => n, StringComparer.Ordinal);

    private static T Deserialize<T>(byte[] bytes, string file) =>
        JsonSerializer.Deserialize<T>(bytes, Json)
            ?? throw new InvalidDataException($"T-DISC pack file {file} is empty.");

    private sealed record ImplementsFile(JsonElement[][] Rows);

    private sealed record OperationsFile(JsonElement[][] Rows);
}

public sealed record TDiscManifest(
    string Method,
    string Version,
    string Label,
    TDiscSource Source,
    string FormulaFingerprint,
    Dictionary<string, string> Files);

public sealed record TDiscSource(string File, string Sha256, string VersionLabel, string? WorkbookModified);

/// <summary>A T-DISC implement: its soil mixing efficiency (0-1) and tillage depth in cm.</summary>
public sealed record TDiscImplement(string Name, double MixingEfficiency, double DepthCm);

/// <summary>A tillage window (e.g. "Field_Preparation") and the implements USDA allows in it.</summary>
public sealed record TDiscWindow(string Key, string Label, string[] Implements);

/// <summary>USDA's lookup: an everyday operation name and the T-DISC implements to enter for it, one pass each.</summary>
public sealed record TDiscOperation(string Name, string[] Implements);

/// <summary>
/// The window index divides a window's tillage intensity by <see cref="IndexDepthCm"/>; a rating is
/// designated by the smallest limit at or above it (the workbook's MATCH(…, -1)).
/// </summary>
public sealed record TDiscRules(double IndexDepthCm, int MaxPasses, TDiscLimit[] Designations);

/// <summary>A designation (NT, RT or CT) and the highest rating it covers.</summary>
public sealed record TDiscLimit(double Max, string Designation);

public sealed record TDiscGoldenCases(TDiscGoldenCase[] Cases, TDiscGoldenConfirmation? ConfirmedInExcel);

public sealed record TDiscGoldenConfirmation(string On, string WorkbookSha256, string How);

public sealed record TDiscGoldenCase(string Name, TDiscPassInput[] Passes, TDiscGoldenExpected? Expected);

/// <summary>Excel's J7 (rating), J8 (designation) and J11:K15 (each window's index and designation).</summary>
public sealed record TDiscGoldenExpected(double Rating, string Designation, Dictionary<string, TDiscGoldenWindow> Windows);

public sealed record TDiscGoldenWindow(double? Index, string? Designation);
