using System.Text.RegularExpressions;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Maps API paths + HTTP methods to the (featureCode, subFeatureCode) pairs the Usage
/// Dashboard reports on. Rules are ordered most-specific-first.
/// <para>
/// Every rule here corresponds to a route that actually exists. When you add or rename a
/// controller route, add a case to FeatureNameMapperTests — a rule that matches nothing
/// silently drops that activity into the "other" bucket.
/// </para>
/// </summary>
public static class FeatureNameMapper
{
    private static readonly Regex CustomerTradeUnitsPattern =
        new(@"^/api/customers/\d+/trade-units", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex CustomerIdPattern =
        new(@"^/api/customers/\d+", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// Returns (featureCode, subFeatureCode) for a given HTTP method + request path.
    /// </summary>
    public static (string FeatureCode, string? SubFeatureCode) MapPathDetailed(string method, string path)
    {
        var p = (path ?? string.Empty).ToLowerInvariant();
        var m = (method ?? string.Empty).ToUpperInvariant();

        // ---- Producer (customer) page ----
        // Trade-unit assignment is a producer-details action, not a profile view, so it has
        // to be tested before the bare /api/customers/{id} rule.
        if (CustomerTradeUnitsPattern.IsMatch(p))
            return ("customers", "trade-unit-assignment");
        if (CustomerIdPattern.IsMatch(p))
            return ("customers", "customer-details");
        if (p.StartsWith("/api/customers"))
            return ("customers", "customer-list");

        if (p.StartsWith("/api/notes"))
            return ("customers", MapNotes(m, p));
        if (p.StartsWith("/api/contracts"))
            return ("customers", "contracts");
        if (p.StartsWith("/api/tickets"))
            return ("customers", "tickets");
        if (p.StartsWith("/api/plantingintentions"))
            return ("customers", "planting-intentions");
        if (p.StartsWith("/api/storedgrain"))
            return ("customers", "storage");
        if (p.StartsWith("/api/dpcontracts"))
            return ("customers", "dp-contracts");
        if (p.StartsWith("/api/producerdetails"))
            return ("customers", "producer-details");

        // ---- Planting Intentions dashboard ----
        if (p.StartsWith("/api/dashboardplantingestimates"))
            return ("dashboard", MapDashboard(p));

        // ---- Build a List ----
        if (p.StartsWith("/api/savedlists/assign"))
            return ("build-a-list", "assign-list");
        if (p.StartsWith("/api/savedlists"))
            return ("build-a-list", m == "POST" ? "save-list" : "manage-members");
        if (p.StartsWith("/api/query-library/search-log"))
            return ("build-a-list", "library-search-log");
        if (p.StartsWith("/api/query-library"))
            return ("build-a-list", "library-list");

        // ---- Bid Sheet ----
        if (p.StartsWith("/api/bidsheet"))
            return ("bidsheet", MapBidSheet(m, p));

        // ---- Daily Recap ----
        if (p.StartsWith("/api/dailyrecapgroups"))
            return ("daily-recap", MapDailyRecap(m, p));

        // ---- Usage Dashboard itself ----
        if (p.StartsWith("/api/usage-dashboard"))
            return ("usage-dashboard", null);

        // ---- Supporting features (not primary screens) ----
        if (p.StartsWith("/api/commodities"))
            return ("system", "commodities");
        if (p.StartsWith("/api/trade-units") || p.StartsWith("/api/usertradeunits"))
            return ("system", "trade-units");
        // The only thing user preferences stores is the trade-unit/group selection, so a write here
        // *is* a selection change — which is more useful to report than "saved a preference".
        if (p.StartsWith("/api/userpreferences"))
            return ("system", m == "PUT" ? "trade-unit-selection" : "user-preferences");
        if (p.StartsWith("/api/entitlements"))
            return ("system", "entitlements");
        if (p.StartsWith("/api/geocode"))
            return ("system", "geocode");
        if (p.StartsWith("/api/diagnostics"))
            return ("system", "diagnostics");
        if (p.StartsWith("/api/farms"))
            return ("system", "farms");
        if (p == "/api/me" || p.StartsWith("/api/me/"))
            return ("system", "identity");

        // Release notes and the build stamp: both are app-chrome reads, not a screen of their own.
        if (p.StartsWith("/api/whats-new"))
            return ("system", "whats-new");
        if (p.StartsWith("/api/version"))
            return ("system", "version");

        return ("other", null);
    }

    private static string? MapNotes(string method, string path)
    {
        if (method == "POST")
            return "notes-create";
        // PUT /api/notes/{id}/toggle-pin has to beat the generic edit rule below.
        if (path.EndsWith("/toggle-pin"))
            return "notes-pin";
        if (method == "PUT")
            return "notes-edit";
        if (method == "DELETE")
            return "notes-delete";
        // GET reads (list, last-contact, mention-catalog) aren't a tracked sub-feature.
        return null;
    }

    private static string MapDashboard(string path)
    {
        // Writes are POST .../upsert, so method alone can't distinguish a tab view from a save.
        if (path.StartsWith("/api/dashboardplantingestimates/actualharvest"))
            return "harvest-contracts";
        if (path.StartsWith("/api/dashboardplantingestimates/marketshares/upsert"))
            return "set-season-targets";
        if (path.StartsWith("/api/dashboardplantingestimates/marketshares"))
            return "top-producers";
        if (path.StartsWith("/api/dashboardplantingestimates/upsert"))
            return "set-season-targets";
        return "by-crop";
    }

    private static string MapBidSheet(string method, string path)
    {
        // Bids are saved with POST bids/bulk.
        if (path.StartsWith("/api/bidsheet/bids"))
            return method is "POST" or "PUT" ? "edit-bids" : "bid-sheet-panel";
        if (path.StartsWith("/api/bidsheet/locations"))
            return method == "POST" ? "add-locations" : "bid-sheet-panel";
        if (path.StartsWith("/api/bidsheet/elevators"))
            return "elevators";
        return "bid-sheet-panel";
    }

    private static string? MapDailyRecap(string method, string path)
    {
        if (method == "POST")
            return "group-created";
        // PUT /api/dailyrecapgroups/{id}/enabled has to beat the generic edit rule below.
        if (path.EndsWith("/enabled"))
            return "group-toggled";
        if (method == "PUT")
            return "group-edited";
        if (method == "DELETE")
            return "group-deleted";
        return null;
    }
}
