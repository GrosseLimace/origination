using System.Text.Json;
using System.Text.Json.Nodes;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services.FdCic;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.FieldPlan;

/// <summary>
/// What the server knows about each sustainability program: which crops it applies to, what a record still
/// needs, the enrollment statements, and how a locked estimate is built. The client's program definitions
/// (client/.../field-plan/programs) hold the same rules for the screen; these are the ones that count.
/// Keep the two in step: the frozen shapes here must match each program's client-side freeze().
/// </summary>
public static class FieldPlanPrograms
{
    /// <summary>45Z, the only approved program. Another program adds its key, rules and freeze here.</summary>
    public const string FdCic = "45z-fdcic";

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>45Z's attestation statements (keys as in fd-cic.program.ts).</summary>
    private static readonly Dictionary<string, (string Key, string Short)[]> Statements = new()
    {
        [FdCic] =
        [
            ("notEnrolledElsewhere", "\"not enrolled elsewhere\" confirmation"),
            ("recordsAccurate", "\"records are accurate\" confirmation"),
            ("consentToThirdPartyAudit", "consent to third-party audit"),
            ("firstPointOfAggregationAck", "first-point-of-aggregation acknowledgment"),
        ],
    };

    private static readonly Dictionary<string, string> TillageLabels = new()
    {
        ["ReducedTill"] = "Reduced till", ["NoTill"] = "No till", ["NoneOfTheAbove"] = "None of the above",
    };

    private static readonly Dictionary<string, string> CoverLabels = new()
    {
        ["CoverCrop"] = "Cover crop", ["CoverCropGrazed"] = "Cover crop with grazing", ["None"] = "No cover crop",
    };

    public static bool IsKnown(string programKey) => programKey is FdCic;

    public static bool AppliesTo(string programKey, string cropLabel) => programKey switch
    {
        FdCic => FdCicCropFor(cropLabel) is not null,
        _ => false,
    };

    public static bool HasEnrollment(string programKey) => Statements.ContainsKey(programKey);

    public static IReadOnlyList<(string Key, string Short)> StatementsFor(string programKey) =>
        Statements.TryGetValue(programKey, out var s) ? s : [];

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
    /// Reads and checks a record's data for its program. Throws a ValidationException when it isn't that
    /// program's shape, so nothing unreadable is stored.
    /// </summary>
    public static void ValidateData(string programKey, JsonElement data)
    {
        if (data.ValueKind != JsonValueKind.Object)
            throw new ValidationException("data", "Program data must be an object.");
        if (data.GetRawText().Length > 20_000)
            throw new ValidationException("data", "Program data is too large.");
        ReadFdCic(data);
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

    private sealed record FdCicData(
        double? ExpectedYield, double? ActualYield, double? SyntheticN, double NiFraction,
        string CoverCrop, string Tillage, IReadOnlyList<ManureData> Manure);

    private sealed record ManureData(string? Type, string? Form, double? Amount, double? NContent);

    private static FdCicData ReadFdCic(JsonElement data)
    {
        FdCicData? d;
        try { d = data.Deserialize<FdCicData>(Json); }
        catch (JsonException) { d = null; }
        if (d is null || !TillageLabels.ContainsKey(d.Tillage ?? "") || !CoverLabels.ContainsKey(d.CoverCrop ?? "")
            || d.NiFraction is < 0 or > 1 || d.Manure is null || d.Manure.Count > FdCicInputRules.MaxManureEntries)
            throw new ValidationException("data", "These aren't 45Z inputs.");
        return d;
    }
}
