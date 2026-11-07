using System.Text.Json;
using System.Text.Json.Nodes;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.FdCic;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Services;

/// <summary>
/// What the server knows about each sustainability program: which crops it applies to, what a record still
/// needs, and how a locked estimate is built. The client's program definitions
/// (client/.../field-plan/programs) hold the same rules for the screen; these are the ones that count.
/// Keep the two in step: the frozen shapes here must match each program's client-side freeze().
/// </summary>
public static class FieldPlanPrograms
{
    /// <summary>45Z, the only approved program. Another program adds its key, rules and freeze here.</summary>
    public const string FdCic = "45z-fdcic";

    /// <summary>
    /// Reads names case-insensitively, so "tillage" and "Tillage" are one property: a body naming it twice is refused
    /// rather than letting the two readings disagree.
    /// </summary>
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { AllowDuplicateProperties = false };

    private static readonly Dictionary<string, string> TillageLabels = new()
    {
        ["ReducedTill"] = "Reduced till", ["NoTill"] = "No till", ["NoneOfTheAbove"] = "None of the above",
    };

    private static readonly Dictionary<string, string> CoverLabels = new()
    {
        ["CoverCrop"] = "Cover crop", ["CoverCropGrazed"] = "Cover crop with grazing", ["None"] = "No cover crop",
    };

    public static bool IsKnown(string programKey) => programKey is FdCic;

    /// <summary>A stored tillage key's USDA label ("NoTill" → "No till").</summary>
    public static string TillageLabel(string tillage) => TillageLabels[tillage];

    /// <summary>A USDA tillage label's stored key ("No till" → "NoTill"), or null when it isn't one.</summary>
    public static string? TillageKey(string? label) =>
        TillageLabels.FirstOrDefault(kv => string.Equals(kv.Value, label, StringComparison.Ordinal)).Key;

    public static bool AppliesTo(string programKey, string cropLabel) => programKey switch
    {
        FdCic => FdCicCropFor(cropLabel) is not null,
        _ => false,
    };

    /// <summary>A planting row's crop label to an FD-CIC crop, as fdCicCropFor in fd-cic.data.ts.</summary>
    public static string? FdCicCropFor(string cropLabel)
    {
        var label = cropLabel.ToLowerInvariant();
        if (label.Contains("popcorn")) return null;
        if (label.Contains("corn")) return "Corn";
        if (label.Contains("soy")) return "Soybean";
        if (label.Contains("sorghum") || label.Contains("milo")) return "Sorghum";
        if (label.Contains("canola")) return "Canola";
        return null;
    }

    /// <summary>
    /// Reads and checks a record's data for its program and returns it as the JSON to store: the program's own
    /// fields under their camelCase names, nothing else. Throws a ValidationException when it isn't that program's
    /// shape. Storing this, never the raw body, means every later reader (confirm's T-DISC check, scoring) sees the
    /// same values: a "Tillage" sent in another case can't be read one way when validated and another when confirmed.
    /// </summary>
    public static string ValidateData(string programKey, JsonElement data)
    {
        if (data.ValueKind != JsonValueKind.Object)
            throw new ValidationException("data", "Program data must be an object.");
        if (data.GetRawText().Length > 20_000)
            throw new ValidationException("data", "Program data is too large.");
        return JsonSerializer.Serialize(ReadFdCic(data), Json);
    }

    /// <summary>Stored data in its canonical form (see ValidateData), for records saved before it was enforced.</summary>
    internal static string Canonical(string programKey, string data)
    {
        using var doc = JsonDocument.Parse(data);
        return ValidateData(programKey, doc.RootElement);
    }

    /// <summary>What a record still needs before it's Ready (the client's program.missing()).</summary>
    public static IReadOnlyList<string> Missing(string programKey, JsonElement data, ProducerFieldSeason season)
    {
        var d = ReadFdCic(data);
        var missing = new List<string>();
        if (season.Acres is not > 0) missing.Add("acres");
        if (d.ExpectedYield is not > 0) missing.Add("expected yield");
        if (d.SyntheticN is null or < 0) missing.Add("nitrogen rate");
        return missing;
    }

    public static string StatusFor(string programKey, JsonElement data, ProducerFieldSeason season) =>
        Missing(programKey, data, season).Count == 0 ? "Ready" : "Draft";

    /// <summary>
    /// The CI frozen when a field is confirmed, as JSON. 45Z is rescored here with the server's own USDA calculator;
    /// the client's number is never used. Always an estimate (basis "Estimate"), never an official result.
    /// </summary>
    public static string Freeze(FieldProgramRecord record, ProducerFieldSeason season, ProducerField field,
        IFdCicService fdCic, string lockedBy, DateTime lockedAt)
    {
        using var doc = JsonDocument.Parse(record.Data);
        var frozen = FreezeFdCic(doc.RootElement, season, field, fdCic);
        frozen["basis"] = "Estimate";
        frozen["lockedBy"] = lockedBy;
        frozen["lockedAt"] = lockedAt.ToString("o");
        return frozen.ToJsonString(Json);
    }

    private static JsonObject FreezeFdCic(JsonElement data, ProducerFieldSeason season, ProducerField field, IFdCicService fdCic)
    {
        var d = ReadFdCic(data);
        var missing = Missing(FdCic, data, season).ToList();
        if (d.ActualYield is not > 0) missing.Add("actual yield");
        var crop = FdCicCropFor(season.CropLabel);
        if (crop is null) missing.Add("a crop USDA scores");
        if (string.IsNullOrWhiteSpace(field.State) || string.IsNullOrWhiteSpace(field.County)) missing.Add("the field's state and county");
        if (missing.Count > 0) throw StillNeeded(missing);

        var score = fdCic.Score(season.CropYear, new FdCicInput(
            crop!, field.State!, field.County!, d.ActualYield, d.ExpectedYield!.Value, d.SyntheticN!.Value, d.NiFraction,
            CoverLabels[d.CoverCrop], TillageLabels[d.Tillage],
            d.Manure.Select(m => new FdCicManure(m.Amount ?? 0, m.NContent ?? 0)).ToList()));
        if (!score.Scorable || score.Ci is null) throw StillNeeded([$"a USDA score ({score.UnscorableReason})"]);

        // The same shape as fd-cic.program.ts freeze().
        return new JsonObject
        {
            ["inputs"] = new JsonObject
            {
                ["crop"] = season.CropLabel, ["fdCicCrop"] = crop, ["cropYear"] = season.CropYear, ["field"] = field.Name,
                ["splitId"] = field.SplitId, ["splitPercent"] = field.SplitPercent,
                ["state"] = field.State, ["county"] = field.County, ["acres"] = season.Acres,
                ["expectedYield"] = d.ExpectedYield, ["actualYield"] = d.ActualYield,
                ["syntheticN"] = d.SyntheticN, ["niPercent"] = Math.Round(d.NiFraction * 100),
                ["coverCrop"] = CoverLabels[d.CoverCrop], ["tillage"] = TillageLabels[d.Tillage],
                ["tDiscRating"] = d.TDiscRating,
                ["manure"] = data.TryGetProperty("manure", out var manure) ? JsonNode.Parse(manure.GetRawText()) : new JsonArray(),
            },
            ["outputs"] = new JsonObject
            {
                ["ciGPerBu"] = score.Ci, ["nationalAverage"] = score.NationalAverage, ["vsNational"] = score.ChangeFraction,
                ["yieldUsed"] = score.YieldForCi, ["mlra"] = score.Mlra,
                ["components"] = JsonSerializer.SerializeToNode(score.Components, Json),
                ["breakdown"] = JsonSerializer.SerializeToNode(score.Breakdown, Json),
                ["usdaVersion"] = score.Version, ["usdaWorkbookSha256"] = score.SourceSha256,
                ["usdaFormulaFingerprint"] = score.FormulaFingerprint,
            },
            ["score"] = new JsonObject { ["value"] = score.Ci, ["unit"] = "g CO₂e/bu", ["unitShort"] = "g/bu" },
            ["calculatorVersion"] = score.Label,
        };
    }

    private static BusinessException StillNeeded(IEnumerable<string> missing) =>
        new($"Still needed before confirming: {string.Join(", ", missing)}.", "FIELD_PLAN_LOCK_INCOMPLETE", StatusCodes.Status422UnprocessableEntity);

    /// <summary>T-DISC's management unit takes 20 passes.</summary>
    private const int MaxTDiscPasses = 20;

    private sealed record FdCicData(
        double? ExpectedYield, double? ActualYield, double? SyntheticN, double NiFraction,
        string CoverCrop, string Tillage, IReadOnlyList<ManureData> Manure, double? TDiscRating = null,
        IReadOnlyList<TDiscPassData>? TDiscPasses = null);

    private sealed record ManureData(string? Type, string? Form, double? Amount, double? NContent);

    /// <summary>A pass saved while the review is open. Checked against T-DISC only at confirm, which rates them.</summary>
    private sealed record TDiscPassData(string? Window, string? Implement);

    private static FdCicData ReadFdCic(JsonElement data)
    {
        FdCicData? d;
        try { d = data.Deserialize<FdCicData>(Json); }
        catch (JsonException) { d = null; }
        if (d is null || !TillageLabels.ContainsKey(d.Tillage ?? "") || !CoverLabels.ContainsKey(d.CoverCrop ?? "")
            || d.NiFraction is < 0 or > 1 || d.TDiscRating is < 0 or > 1 || d.Manure is null || d.Manure.Count > FdCicInputRules.MaxManureEntries
            || d.TDiscPasses is { Count: > MaxTDiscPasses } || d.TDiscPasses?.Any(p => p is null || p.Window is not { Length: <= 40 } || p.Implement is not { Length: <= 100 }) == true)
            throw new ValidationException("data", "These aren't 45Z inputs.");
        return d;
    }
}
