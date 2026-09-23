namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a user's saved trade-unit / group selections. Used both as the GET
/// response and the PUT request body. The stored entity keeps these as JSON-array strings; the
/// service handles the (de)serialization.</summary>
public class UserPreferenceDto
{
    public string[] SelectedGroupNames { get; set; } = [];
    public string[] SelectedTradeUnits { get; set; } = [];
}
