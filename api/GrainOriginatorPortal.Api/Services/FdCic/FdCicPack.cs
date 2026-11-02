using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Services.FdCic;

/// <summary>
/// One USDA FD-CIC version's data: the tables, constants and option labels extracted from USDA's
/// workbook by tools/fdcic-extract, plus the Excel-confirmed test cases. Packs are embedded in the
/// assembly as <c>FdCic/v&lt;version&gt;/&lt;file&gt;.json</c> (see the .csproj and docs/45z/README.md).
/// Loading checks every data file against the SHA-256 recorded in the pack's manifest, so a pack
/// that was edited by hand or corrupted is refused rather than scored with.
/// </summary>
public sealed record FdCicPack
{
    private const string ResourcePrefix = "FdCic/v";

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public required FdCicManifest Manifest { get; init; }
    public required FdCicConstants Constants { get; init; }
    public required FdCicOptionLists Options { get; init; }
    public required IReadOnlyList<FdCicCounty> Counties { get; init; }
    public required FdCicIefTable Ief { get; init; }
    public required FdCicPracticeTable Csa { get; init; }
    public required FdCicPracticeTable NiImpact { get; init; }
    public required FdCicGoldenCases Golden { get; init; }

    public string Version => Manifest.Version;
    public string Label => Manifest.Label;

    /// <summary>The county's MLRA. Null when the county is not in the table or USDA gives it no MLRA.</summary>
    public string? MlraFor(string state, string county) =>
        Counties.FirstOrDefault(c =>
            string.Equals(c.State, state, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(c.County, county, StringComparison.OrdinalIgnoreCase))?.Mlra;

    public bool HasCounty(string state, string county) =>
        Counties.Any(c =>
            string.Equals(c.State, state, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(c.County, county, StringComparison.OrdinalIgnoreCase));

    /// <summary>The versions embedded in this assembly, e.g. "1.2".</summary>
    public static IReadOnlyList<string> EmbeddedVersions(Assembly? assembly = null) =>
        ResourceNames(assembly ?? typeof(FdCicPack).Assembly).Keys
            .Where(name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal) && name.EndsWith("/manifest.json", StringComparison.Ordinal))
            .Select(name => name[ResourcePrefix.Length..^"/manifest.json".Length])
            .Order(StringComparer.Ordinal)
            .ToList();

    /// <summary>Loads and verifies an embedded pack. Throws <see cref="InvalidDataException"/> when the
    /// pack is missing, incomplete, or a file's hash does not match its manifest.</summary>
    public static FdCicPack LoadEmbedded(string version, Assembly? assembly = null)
    {
        assembly ??= typeof(FdCicPack).Assembly;
        var resources = ResourceNames(assembly);
        string folder = $"{ResourcePrefix}{version}/";

        byte[] Read(string file)
        {
            if (!resources.TryGetValue(folder + file, out var actualName))
                throw new InvalidDataException($"FD-CIC v{version} pack has no {file}. Confirm the pack folder exists under Content/FdCic.");
            using var stream = assembly.GetManifestResourceStream(actualName)!;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            return buffer.ToArray();
        }

        var manifest = Deserialize<FdCicManifest>(Read("manifest.json"), "manifest.json");
        if (manifest.Version != version)
            throw new InvalidDataException($"FD-CIC pack folder v{version} holds a manifest for v{manifest.Version}.");

        T Verified<T>(string file)
        {
            var bytes = Read(file);
            if (!manifest.Files.TryGetValue(file, out var expectedHash))
                throw new InvalidDataException($"FD-CIC v{version} manifest has no hash for {file}.");
            var actualHash = Convert.ToHexStringLower(SHA256.HashData(bytes));
            if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException(
                    $"FD-CIC v{version} {file} does not match its manifest hash. Pack files must only be written by tools/fdcic-extract.");
            return Deserialize<T>(bytes, file);
        }

        var counties = Verified<CountiesFile>("counties.json");
        return new FdCicPack
        {
            Manifest = manifest,
            Constants = Verified<FdCicConstants>("constants.json"),
            Options = Verified<FdCicOptionLists>("options.json"),
            Counties = counties.Rows.Select(FdCicCounty.FromRow).ToList(),
            Ief = Verified<FdCicIefTable>("ief.json"),
            Csa = Verified<FdCicPracticeTable>("csa.json"),
            NiImpact = Verified<FdCicPracticeTable>("ni-impact.json"),
            // Test cases are written by hand (inputs) and by golden.mjs (Excel's results), so they carry no
            // manifest hash; the version gate checks they were confirmed against this pack's workbook.
            Golden = Deserialize<FdCicGoldenCases>(Read("golden-cases.json"), "golden-cases.json"),
        };
    }

    // Resource names use "\" or "/" after the version folder depending on the build OS (see the .csproj).
    private static Dictionary<string, string> ResourceNames(Assembly assembly) =>
        assembly.GetManifestResourceNames().ToDictionary(n => n.Replace('\\', '/'), n => n, StringComparer.Ordinal);

    private static T Deserialize<T>(byte[] bytes, string file) =>
        JsonSerializer.Deserialize<T>(bytes, Json)
            ?? throw new InvalidDataException($"FD-CIC pack file {file} is empty.");

    private sealed record CountiesFile(JsonElement[][] Rows);
}

public sealed record FdCicManifest(
    string Method,
    string Version,
    string Label,
    FdCicSource Source,
    string FormulaFingerprint,
    Dictionary<string, string> Files);

public sealed record FdCicSource(string File, string Sha256, string VersionLabel, string? WorkbookModified);

public sealed record FdCicConstants(
    double GPerLb,
    double N2oNToN2o,
    double GwpN2o,
    double YieldLowerBound,
    double YieldUpperBound,
    FdCicFixedPractice FixedPractice,
    Dictionary<string, FdCicCropConstants> Crops)
{
    public FdCicCropConstants? Crop(string crop) =>
        Crops.FirstOrDefault(c => string.Equals(c.Key, crop, StringComparison.OrdinalIgnoreCase)).Value;
}

/// <summary>The practice keys the workbook fixes on hidden rows (N timing, binary inhibitor flag).</summary>
public sealed record FdCicFixedPractice(string Timing, string Inhibitor);

public sealed record FdCicCropConstants(
    double DefaultNui,
    double NuiThreshold,
    double ResidueNGPerBu,
    double NFixationGN2oPerBu,
    FdCicNationalAverage National);

/// <summary>USDA's national-average CI components for a crop, g CO2e/bu.</summary>
public sealed record FdCicNationalAverage(
    double NFertilizer,
    double DirectN2o,
    double IndirectN2o,
    double OnFarmFuel,
    double OnFarmOther,
    double OtherChemicals,
    double Urea,
    double Lime,
    double Total);

public sealed record FdCicOptionLists(
    string[] Crops,
    string[] CoverCrops,
    string[] Tillage,
    FdCicManureType[] ManureTypes);

public sealed record FdCicManureType(string Label, string Unit, double? LikelyMaxNPerUnit);

public sealed record FdCicCounty(int Fips, string State, string County, string? Mlra)
{
    internal static FdCicCounty FromRow(JsonElement[] row) => new(
        row[0].GetInt32(),
        row[1].GetString()!,
        row[2].GetString()!,
        row[3].ValueKind == JsonValueKind.Null ? null : row[3].GetString());
}

/// <summary>N2O implied emission factors, percent of applied N: crop → MLRA → [direct, indirect].</summary>
public sealed record FdCicIefTable(Dictionary<string, Dictionary<string, double?[]>> Crops)
{
    public (double? Direct, double? Indirect) For(string crop, string mlra)
    {
        var byMlra = Crops.FirstOrDefault(c => string.Equals(c.Key, crop, StringComparison.OrdinalIgnoreCase)).Value;
        return byMlra is not null && byMlra.TryGetValue(mlra, out var v) ? (v[0], v[1]) : (null, null);
    }
}

/// <summary>A practice table (CSA or NI_Impact): per crop, the practice columns and, per MLRA, one value
/// array per block aligned to those columns. Null values are "NA" in the workbook.</summary>
public sealed record FdCicPracticeTable(Dictionary<string, FdCicPracticeCrop> Crops)
{
    /// <summary>The value for a block (e.g. "socGPerBu") at a crop, MLRA and practice. Null when USDA has no data.</summary>
    public double? Value(string block, string crop, string mlra, string cover, string tillage, FdCicFixedPractice fixedPractice)
    {
        var table = Crops.FirstOrDefault(c => string.Equals(c.Key, crop, StringComparison.OrdinalIgnoreCase)).Value;
        if (table is null) return null;
        int column = Array.FindIndex(table.Practices, p =>
            p.Cover == cover && p.Tillage == tillage && p.Timing == fixedPractice.Timing && p.Inhibitor == fixedPractice.Inhibitor);
        if (column < 0) return null;
        return table.Mlra.TryGetValue(mlra, out var blocks) && blocks.TryGetValue(block, out var values) ? values[column] : null;
    }
}

public sealed record FdCicPracticeCrop(FdCicPractice[] Practices, Dictionary<string, Dictionary<string, double?[]>> Mlra);

public sealed record FdCicPractice(string Cover, string Tillage, string Timing, string Inhibitor, string Scenario);

public sealed record FdCicGoldenCases(FdCicGoldenCase[] Cases, FdCicGoldenConfirmation? ConfirmedInExcel);

public sealed record FdCicGoldenConfirmation(string On, string WorkbookSha256, string How);

public sealed record FdCicGoldenCase(
    string Name,
    string Crop,
    string State,
    string County,
    double ActualYield,
    double ExpectedYield,
    double SyntheticN,
    double NiFraction,
    string CoverCrop,
    string Tillage,
    FdCicManure[] Manure,
    FdCicGoldenExpected? Expected)
{
    public FdCicInput ToInput() =>
        new(Crop, State, County, ActualYield, ExpectedYield, SyntheticN, NiFraction, CoverCrop, Tillage, Manure);
}

/// <summary>Excel's result for a test case: either an error (e.g. "#N/A") or every output cell.</summary>
public sealed record FdCicGoldenExpected(
    string? Error,
    double? YieldForCi,
    double? NFertilizer,
    double? SoilCarbon,
    double? DirectN2o,
    double? IndirectN2o,
    double? OnFarmEnergy,
    double? OtherChemicals,
    double? UreaLime,
    double? Ci,
    double? NationalAverage,
    double? ChangeFraction);
