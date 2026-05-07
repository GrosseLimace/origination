namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents an eSign enrollment record fed from a Power Automate flow.
/// Stores per-customer eSign status and ScoularView recipient information.
/// </summary>
public class ESignEnrollment
{
    public int Id { get; set; }
    public string CustomerCode { get; set; } = string.Empty;      // Matches Customer.ScoularId
    public string CustomerName { get; set; } = string.Empty;
    public bool ESignEnabled { get; set; }
    public string? ScoularViewRecipients { get; set; }             // Comma-separated "Name | email/phone"
    public string? Guild { get; set; }
    public DateTime UpdatedOn { get; set; }
}
