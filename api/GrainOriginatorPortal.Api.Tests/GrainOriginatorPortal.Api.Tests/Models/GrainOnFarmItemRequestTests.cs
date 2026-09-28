// System namespaces
using System.Text.Json;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Grain on Farm switched its row key from CommodityGroup to CommodityCode on 2026-09-23. A browser
/// tab still running the old SPA mid-deploy sends the old name; the repository replaces the whole
/// set on save, so ignoring that field would wipe the producer's grain rows. These pin the one-release
/// compatibility shim.
/// </summary>
public class GrainOnFarmItemRequestTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void NewClientPayload_UsesCommodityCode()
    {
        var item = JsonSerializer.Deserialize<GrainOnFarmItemRequest>(
            """{ "commodityCode": "HRWW", "bushelsOnHand": 100 }""", Web)!;
        Assert.Equal("HRWW", item.EffectiveCommodityCode);
    }

    [Fact]
    public void OldClientPayload_FallsBackToCommodityGroup()
    {
        var item = JsonSerializer.Deserialize<GrainOnFarmItemRequest>(
            """{ "commodityGroup": "Corn", "bushelsOnHand": 100 }""", Web)!;
        Assert.Equal("Corn", item.EffectiveCommodityCode);
    }

    [Fact]
    public void CodeWinsWhenBothAreSent_AndBlankCodeFallsBack()
    {
        Assert.Equal("YC", new GrainOnFarmItemRequest { CommodityCode = "YC", CommodityGroup = "Corn" }.EffectiveCommodityCode);
        Assert.Equal("Corn", new GrainOnFarmItemRequest { CommodityCode = "  ", CommodityGroup = "Corn" }.EffectiveCommodityCode);
        Assert.Equal(string.Empty, new GrainOnFarmItemRequest().EffectiveCommodityCode);
    }

    [Fact]
    public void EffectiveCommodityCode_IsNotSerialized()
    {
        var json = JsonSerializer.Serialize(new GrainOnFarmItemRequest { CommodityCode = "YC" }, Web);
        Assert.DoesNotContain("effectiveCommodityCode", json);
    }
}
