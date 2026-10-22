// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Pins the request-path to (featureCode, subFeatureCode) mapping that the Usage Dashboard
/// reports on. Every path below is a route that actually exists in a controller — if a route
/// is renamed, this suite fails instead of silently reclassifying the activity as "other".
/// </summary>
public class FeatureNameMapperTests
{
    [Theory]
    // ---- Producer (customer) page -------------------------------------------------
    [InlineData("GET", "/api/customers", "customers", "customer-list")]
    [InlineData("GET", "/api/customers/search?q=smith", "customers", "customer-list")]
    [InlineData("GET", "/api/customers/by-source/12345", "customers", "customer-list")]
    [InlineData("GET", "/api/customers/4821", "customers", "customer-details")]
    [InlineData("PUT", "/api/customers/4821", "customers", "customer-details")]
    // Trade-unit assignment must NOT be counted as a profile view.
    [InlineData("GET", "/api/customers/4821/trade-units", "customers", "trade-unit-assignment")]
    [InlineData("PUT", "/api/customers/4821/trade-units", "customers", "trade-unit-assignment")]
    [InlineData("DELETE", "/api/customers/4821/trade-units/TU1", "customers", "trade-unit-assignment")]
    // ---- Notes lifecycle ----------------------------------------------------------
    [InlineData("POST", "/api/notes", "customers", "notes-create")]
    [InlineData("PUT", "/api/notes/91", "customers", "notes-edit")]
    [InlineData("DELETE", "/api/notes/91", "customers", "notes-delete")]
    [InlineData("PUT", "/api/notes/91/toggle-pin", "customers", "notes-pin")]
    [InlineData("GET", "/api/notes", "customers", null)]
    [InlineData("GET", "/api/notes/last-contact", "customers", null)]
    [InlineData("GET", "/api/notes/mention-catalog", "customers", null)]
    // ---- Producer profile tabs ----------------------------------------------------
    [InlineData("GET", "/api/contracts/customer/4821", "customers", "contracts")]
    [InlineData("GET", "/api/contracts/pricing-lines", "customers", "contracts")]
    [InlineData("GET", "/api/tickets/customer/4821", "customers", "tickets")]
    [InlineData("GET", "/api/plantingintentions/customer/4821", "customers", "planting-intentions")]
    [InlineData("GET", "/api/storedgrain/customer/4821", "customers", "storage")]
    [InlineData("GET", "/api/dpcontracts/customer/4821", "customers", "dp-contracts")]
    [InlineData("PUT", "/api/producerdetails/customer/4821", "customers", "producer-details")]
    // ---- Planting Intentions dashboard --------------------------------------------
    // Saves are POST .../upsert, so they must not fall through to the by-crop view rule.
    [InlineData("GET", "/api/dashboardplantingestimates", "dashboard", "by-crop")]
    [InlineData("GET", "/api/dashboardplantingestimates/summary", "dashboard", "by-crop")]
    [InlineData("POST", "/api/dashboardplantingestimates/upsert", "dashboard", "set-season-targets")]
    [InlineData("GET", "/api/dashboardplantingestimates/marketshares", "dashboard", "top-producers")]
    [InlineData("POST", "/api/dashboardplantingestimates/marketshares/upsert", "dashboard", "set-season-targets")]
    [InlineData("GET", "/api/dashboardplantingestimates/actualharvest", "dashboard", "harvest-contracts")]
    [InlineData("POST", "/api/dashboardplantingestimates/actualharvest/upsert", "dashboard", "harvest-contracts")]
    // A harvest-row delete is a Harvest tab action, not a season-target edit.
    [InlineData("DELETE", "/api/dashboardplantingestimates/actualharvest/7", "dashboard", "harvest-contracts")]
    // ---- Build a List -------------------------------------------------------------
    [InlineData("POST", "/api/savedlists", "build-a-list", "save-list")]
    [InlineData("GET", "/api/savedlists", "build-a-list", "manage-members")]
    [InlineData("GET", "/api/savedlists/team", "build-a-list", "manage-members")]
    [InlineData("PUT", "/api/savedlists/12", "build-a-list", "manage-members")]
    [InlineData("DELETE", "/api/savedlists/12", "build-a-list", "manage-members")]
    // Assigning a list to a teammate is not creating one.
    [InlineData("POST", "/api/savedlists/assign", "build-a-list", "assign-list")]
    [InlineData("GET", "/api/query-library", "build-a-list", "library-list")]
    [InlineData("POST", "/api/query-library/search-log", "build-a-list", "library-search-log")]
    // ---- Bid Sheet ----------------------------------------------------------------
    [InlineData("GET", "/api/bidsheet/locations", "bidsheet", "bid-sheet-panel")]
    [InlineData("POST", "/api/bidsheet/locations", "bidsheet", "add-locations")]
    [InlineData("DELETE", "/api/bidsheet/locations/3", "bidsheet", "bid-sheet-panel")]
    [InlineData("DELETE", "/api/bidsheet/locations/3/bids/CORN", "bidsheet", "bid-sheet-panel")]
    // Bids are saved with POST bids/bulk — previously mislabeled as a panel view.
    [InlineData("POST", "/api/bidsheet/bids/bulk", "bidsheet", "edit-bids")]
    [InlineData("GET", "/api/bidsheet/elevators", "bidsheet", "elevators")]
    [InlineData("GET", "/api/bidsheet/cropyears", "bidsheet", "bid-sheet-panel")]
    [InlineData("PUT", "/api/bidsheet/location-order", "bidsheet", "bid-sheet-panel")]
    [InlineData("PUT", "/api/bidsheet/preference", "bidsheet", "bid-sheet-panel")]
    // ---- Daily Recap --------------------------------------------------------------
    [InlineData("GET", "/api/dailyrecapgroups", "daily-recap", null)]
    [InlineData("POST", "/api/dailyrecapgroups", "daily-recap", "group-created")]
    [InlineData("PUT", "/api/dailyrecapgroups/5", "daily-recap", "group-edited")]
    [InlineData("PUT", "/api/dailyrecapgroups/5/enabled", "daily-recap", "group-toggled")]
    [InlineData("DELETE", "/api/dailyrecapgroups/5", "daily-recap", "group-deleted")]
    // ---- Usage Dashboard itself ---------------------------------------------------
    [InlineData("GET", "/api/usage-dashboard/summary", "usage-dashboard", null)]
    // ---- Supporting features ------------------------------------------------------
    [InlineData("GET", "/api/commodities", "system", "commodities")]
    [InlineData("GET", "/api/commodities/conversions", "system", "commodities")]
    [InlineData("GET", "/api/commodities/harvest-windows", "system", "commodities")]
    [InlineData("GET", "/api/trade-units", "system", "trade-units")]
    [InlineData("GET", "/api/usertradeunits", "system", "trade-units")]
    // The only preference stored is the trade-unit selection, so a write is a selection change.
    [InlineData("PUT", "/api/userpreferences", "system", "trade-unit-selection")]
    [InlineData("GET", "/api/userpreferences", "system", "user-preferences")]
    [InlineData("GET", "/api/entitlements/catalog", "system", "entitlements")]
    [InlineData("POST", "/api/geocode/single", "system", "geocode")]
    [InlineData("GET", "/api/diagnostics/connections", "system", "diagnostics")]
    [InlineData("GET", "/api/me", "system", "identity")]
    [InlineData("GET", "/api/whats-new", "system", "whats-new")]
    [InlineData("GET", "/api/version", "system", "version")]
    [InlineData("GET", "/api/clienttelemetry", "system", "client-telemetry")]
    // ---- Fallback -----------------------------------------------------------------
    [InlineData("GET", "/api/something-new", "other", null)]
    public void MapPathDetailed_MapsRealRoutes(string method, string path, string expectedFeature, string? expectedSubFeature)
    {
        var (featureCode, subFeatureCode) = FeatureNameMapper.MapPathDetailed(method, path);

        Assert.Equal(expectedFeature, featureCode);
        Assert.Equal(expectedSubFeature, subFeatureCode);
    }

    [Theory]
    [InlineData("get", "/API/Customers/4821")]
    [InlineData("GET", "/api/CUSTOMERS/4821")]
    public void MapPathDetailed_IsCaseInsensitive(string method, string path)
    {
        var (featureCode, subFeatureCode) = FeatureNameMapper.MapPathDetailed(method, path);

        Assert.Equal("customers", featureCode);
        Assert.Equal("customer-details", subFeatureCode);
    }

    [Fact]
    public void MapPathDetailed_HandlesEmptyPath()
    {
        var (featureCode, subFeatureCode) = FeatureNameMapper.MapPathDetailed("GET", string.Empty);

        Assert.Equal("other", featureCode);
        Assert.Null(subFeatureCode);
    }
}
