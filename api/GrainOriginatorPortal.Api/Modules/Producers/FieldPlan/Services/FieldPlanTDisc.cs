namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Services;

/// <summary>
/// The USDA T-DISC check a no-till or reduced-till 45Z field needs before its CI is confirmed (7 CFR 2100.051).
/// The rating comes from the field's passes, rated on the server by TDiscCalculator (USDA T-DISC v1.1.1, whose
/// limits are the regulation's: no till ≤ 0.075, reduced till ≤ 0.252). Not needed for an estimate. The
/// client's fd-cic-tdisc.ts holds the same rule for the screen; this one counts.
/// </summary>
public static class FieldPlanTDisc
{
    /// <summary>Whether this stored tillage key needs a T-DISC rating to be confirmed.</summary>
    public static bool IsNeeded(string tillage) => tillage is "NoTill" or "ReducedTill";

    /// <summary>The tillage key for a T-DISC designation: NT → NoTill, RT → ReducedTill, CT → NoneOfTheAbove.</summary>
    public static string Tillage(string designation) => designation switch
    {
        "NT" => "NoTill",
        "RT" => "ReducedTill",
        _ => "NoneOfTheAbove",
    };

    /// <summary>
    /// The tillage the field is confirmed at: the one selected when the rating's designation supports it,
    /// otherwise the designation's own. Only ever steps down (no till → reduced till → none), never up to a
    /// practice not selected.
    /// </summary>
    public static string SupportedTillage(string selected, string designation)
    {
        var supported = Tillage(designation);
        return Rank(supported) >= Rank(selected) ? selected : supported;
    }

    private static int Rank(string tillage) => tillage switch
    {
        "NoTill" => 2,
        "ReducedTill" => 1,
        _ => 0,
    };
}
