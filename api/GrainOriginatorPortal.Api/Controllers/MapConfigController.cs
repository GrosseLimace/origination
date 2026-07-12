namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Hands the SPA runtime map configuration for any MapLibre/Azure Maps consumer that isn't
/// field-tagging-specific (currently: Bid Sheet). Unlike FieldTagConfigController, each key is
/// gated independently — the basemap must work even if LandMapMagic isn't configured, and the
/// CLU/Parcel toggle should hide itself on a missing vendor key without affecting the basemap.
/// Keys come from the same FieldTags:* config section (dotnet user-secrets locally / Key Vault
/// when deployed) as field-tagging — no new secret storage, just decoupled exposure.
/// </summary>
[ApiController]
[Route("api/map-config")]
[Authorize]
[Produces("application/json")]
public class MapConfigController : ControllerBase
{
    private readonly IConfiguration _configuration;

    public MapConfigController(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    [HttpGet]
    [ProducesResponseType(typeof(MapConfigResponse), StatusCodes.Status200OK)]
    public ActionResult<MapConfigResponse> Get()
    {
        var azureMapsKey = _configuration["FieldTags:AzureMapsKey"];
        var landMapMagicKey = _configuration["FieldTags:LandMapMagicKey"];

        return Ok(new MapConfigResponse
        {
            AzureMapsKey = string.IsNullOrWhiteSpace(azureMapsKey) ? null : azureMapsKey,
            LandMapMagicKey = string.IsNullOrWhiteSpace(landMapMagicKey) ? null : landMapMagicKey,
            CdlYear = _configuration["FieldTags:CdlYear"] ?? "2024",
            CdlFallbackYear = _configuration["FieldTags:CdlFallbackYear"] ?? "2023"
        });
    }
}
