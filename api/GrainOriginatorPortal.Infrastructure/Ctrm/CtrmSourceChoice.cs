using Microsoft.Extensions.Configuration;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Per-request record of which data source the caller asked for, and whether they are allowed to ask.
/// </summary>
/// <remarks>
/// <para>Why this exists (2026-10-01). The CTRM go-live needed a side-by-side check of CTRM against ODS on
/// production data before every user is moved. Doing that from QA would have required opening the shared
/// nonprod App Service plan to the production gateway, which the infrastructure team ruled out. So the
/// comparison happens in production itself: a short allow-list of testers can flip their own session
/// between the two sources while everyone else stays on the environment default.</para>
///
/// <para>The server decides, not the browser. The browser only expresses a preference, in the
/// <c>X-Data-Source-Preference</c> request header; it is honoured solely for users named in
/// <c>Ctrm:SourceToggleUsers</c>. Anyone else sending the header is routed exactly as if they had not.
/// Both sources apply the same trade-unit entitlements, so the toggle exposes no data a tester could not
/// already see - it changes where the same rows are read from.</para>
///
/// <para>Registered scoped, like <see cref="CtrmProvenance"/>: one instance per HTTP request, populated by
/// middleware after authentication. Background work (customer sync, keep-warm) has no request and so gets a
/// fresh, empty instance, which resolves to the environment default.</para>
/// </remarks>
public sealed class CtrmSourceChoice
{
    public const string PreferenceHeader = "X-Data-Source-Preference";
    public const string ToggleUsersKey = "Ctrm:SourceToggleUsers";
    public const string SourceKey = "Ctrm:Source";
    public const string Ctrm = "ctrm";
    public const string Ods = "ods";

    /// <summary>The signed-in user's UPN (or object id), as the middleware resolved it. Null when anonymous.</summary>
    public string? UserId { get; private set; }

    /// <summary>The raw header value the caller sent, if any. Normalised only when resolved.</summary>
    public string? RequestedSource { get; private set; }

    /// <summary>Called once per request by the middleware.</summary>
    public void Set(string? userId, string? requestedSource)
    {
        UserId = string.IsNullOrWhiteSpace(userId) ? null : userId.Trim();
        RequestedSource = string.IsNullOrWhiteSpace(requestedSource) ? null : requestedSource.Trim();
    }

    /// <summary>Whether this request's user may choose their own source.</summary>
    public bool CanChoose(IConfiguration configuration) => IsToggleUser(configuration, UserId);

    /// <summary>The source every read in this request routes to: <c>ctrm</c> or <c>ods</c>.</summary>
    public string Resolve(IConfiguration configuration) => Resolve(configuration, UserId, RequestedSource);

    /// <summary>True when <see cref="Resolve(IConfiguration)"/> picked CTRM.</summary>
    public bool UsesCtrm(IConfiguration configuration) => Resolve(configuration) == Ctrm;

    /// <summary>True when the user's own preference, not the environment default, decided the source.</summary>
    public bool UserChoiceApplied(IConfiguration configuration) =>
        IsToggleUser(configuration, UserId) && Normalise(RequestedSource) is not null;

    /// <summary>The environment default, independent of any user: <c>ctrm</c> only for the literal opt-in.</summary>
    public static string DefaultSource(IConfiguration configuration) =>
        string.Equals(configuration[SourceKey]?.Trim(), Ctrm, StringComparison.OrdinalIgnoreCase) ? Ctrm : Ods;

    /// <summary>
    /// The routing rule in one place, pure, so it can be tested without HTTP: an allow-listed user with a
    /// valid preference gets that preference; everyone and everything else gets the environment default.
    /// </summary>
    public static string Resolve(IConfiguration configuration, string? userId, string? requestedSource)
    {
        var requested = Normalise(requestedSource);
        if (requested is not null && IsToggleUser(configuration, userId))
            return requested;
        return DefaultSource(configuration);
    }

    /// <summary>
    /// Whether <paramref name="userId"/> is named in <c>Ctrm:SourceToggleUsers</c>. The list is one string,
    /// comma or semicolon separated, so it can be set as a single App Service setting
    /// (<c>Ctrm__SourceToggleUsers</c>) and changed without a redeploy. Case-insensitive, whitespace ignored.
    /// </summary>
    public static bool IsToggleUser(IConfiguration configuration, string? userId)
    {
        if (string.IsNullOrWhiteSpace(userId)) return false;
        var raw = configuration[ToggleUsersKey];
        if (string.IsNullOrWhiteSpace(raw)) return false;
        foreach (var entry in raw.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            if (string.Equals(entry, userId.Trim(), StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    /// <summary>Only the two known values are accepted; anything else is "no preference".</summary>
    public static string? Normalise(string? requestedSource)
    {
        var value = requestedSource?.Trim();
        if (string.Equals(value, Ctrm, StringComparison.OrdinalIgnoreCase)) return Ctrm;
        if (string.Equals(value, Ods, StringComparison.OrdinalIgnoreCase)) return Ods;
        return null;
    }
}
