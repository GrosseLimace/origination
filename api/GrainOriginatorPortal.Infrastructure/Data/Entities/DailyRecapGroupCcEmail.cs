namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A literal CC email address on a <see cref="DailyRecapGroup"/> — extra recipients on top of the
/// resolved member recipients. No re-resolution needed (these are plain addresses).
/// </summary>
public class DailyRecapGroupCcEmail
{
    public int Id { get; set; }
    public int RecapGroupId { get; set; }
    public string Email { get; set; } = string.Empty;

    public DailyRecapGroup? Group { get; set; }
}
