namespace GrainOriginatorPortal.Api.Services.FieldPlan;

/// <summary>
/// Which crop a commodity code is, so a field's crop row (planting intention code, e.g. "YC") can be matched
/// to the product code on its tickets (e.g. "YCNG"). A port of the 45Z crops in the client's CROP_CODE_MAP
/// (client/src/app/shared/utils/crop-group-match.ts), plus wheat (so a field on a wheat row is recognised); a test keeps the two lists
/// in step. A code not listed falls back to its dbo.Commodities category.
/// </summary>
public static class FieldPlanCropGroups
{
    /// <summary>Group → its tokens (lower-case), exactly as in the client's CROP_CODE_MAP.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> Codes = new Dictionary<string, string[]>
    {
        ["wheat"] = ["wheat", "hrww", "srww", "sww", "hww", "hadw", "dnsw", "cwrs", "fdwt", "hrwo", "whto", "whfg"],
        ["corn"] = ["corn", "yc", "yco", "ycng", "ckyc", "ycck", "dmgc"],
        ["soybeans"] = ["soybean", "beans", "sb", "ysb", "nysb", "ysbo", "dngs", "dosb"],
        ["sorghum"] = ["sorghum", "milo", "sor", "soro", "csor", "ro98"],
        ["canola"] = ["canola", "canp", "casm"],
    };

    /// <summary>Pounds per bushel, used only when ODS has no conversion for a code.</summary>
    public static readonly IReadOnlyDictionary<string, decimal> StandardLbsPerBushel = new Dictionary<string, decimal>
    {
        ["wheat"] = 60m, ["corn"] = 56m, ["soybeans"] = 60m, ["sorghum"] = 56m, ["canola"] = 50m,
    };

    private static readonly Dictionary<string, string> ByToken = Codes
        .SelectMany(g => g.Value.Select(t => (Token: t, Group: g.Key)).Append((Token: g.Key, Group: g.Key)))
        .GroupBy(x => x.Token)
        .ToDictionary(x => x.Key, x => x.First().Group);

    /// <summary>The crop group of a commodity code, or of its dbo.Commodities category; null when neither is known.</summary>
    public static string? For(string? code, string? category = null)
    {
        if (code?.Trim().ToLowerInvariant() is { Length: > 0 } c && ByToken.TryGetValue(c, out var group)) return group;
        var cat = category?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(cat)) return null;
        if (ByToken.TryGetValue(cat, out var byCategory)) return byCategory;
        return Codes.Keys.FirstOrDefault(g => cat.Contains(g) || cat.Contains(g.TrimEnd('s')));
    }

    /// <summary>The crop group named by any word of a crop row label, e.g. "Irrigated Corn" → corn; null when none does.</summary>
    public static string? ForLabel(string? label) =>
        (label ?? "").ToLowerInvariant().Split([' ', '-', '/', '(', ')'], StringSplitOptions.RemoveEmptyEntries)
            .Select(w => ByToken.GetValueOrDefault(w) ?? ByToken.GetValueOrDefault(w.TrimEnd('s')))
            .FirstOrDefault(g => g is not null);
}
