namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Hands the SPA its field-tagging runtime map configuration so the LandMapMagic/Azure Maps keys
/// never live in a committed Angular file (client/src/environments/*.ts are all committed — org
/// policy forbids secrets there). Keys come from dotnet user-secrets locally / Key Vault when
/// deployed, via the FieldTags:* config section. Still client-direct: this endpoint changes where
/// the key is stored, not who calls the vendor. See docs/poc/field-tagging/02-backend-api.md.
/// </summary>
[ApiController]
[Route("api/field-tag-config")]
[Authorize]
[Produces("application/json")]
public class FieldTagConfigController : ControllerBase
{
    private readonly IConfiguration _configuration;

    public FieldTagConfigController(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets the field-tagging map configuration. `enabled` is false (and keys are null)
    /// whenever the local store path or either vendor key is missing — the SPA hides the Fields
    /// tab entirely in that case.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(FieldTagConfigResponse), StatusCodes.Status200OK)]
    public ActionResult<FieldTagConfigResponse> Get()
    {
        var localStorePath = _configuration["FieldTags:LocalStorePath"];
        var azureMapsKey = _configuration["FieldTags:AzureMapsKey"];
        var landMapMagicKey = _configuration["FieldTags:LandMapMagicKey"];

        var enabled = !string.IsNullOrWhiteSpace(localStorePath)
            && !string.IsNullOrWhiteSpace(azureMapsKey)
            && !string.IsNullOrWhiteSpace(landMapMagicKey);

        return Ok(new FieldTagConfigResponse
        {
            Enabled = enabled,
            AzureMapsKey = enabled ? azureMapsKey : null,
            LandMapMagicKey = enabled ? landMapMagicKey : null,
            CdlYear = _configuration["FieldTags:CdlYear"] ?? "2024",
            CdlFallbackYear = _configuration["FieldTags:CdlFallbackYear"] ?? "2023"
        });
    }
}
