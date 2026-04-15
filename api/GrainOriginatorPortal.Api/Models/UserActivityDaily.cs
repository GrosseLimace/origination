namespace GrainOriginatorPortal.Api.Models;

public class UserActivityDaily
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public DateOnly ActivityDate { get; set; }
    public int RequestCount { get; set; }
    public int SessionCount { get; set; }
    public int TotalSessionMinutes { get; set; }
    public int CustomersViewed { get; set; }
    public int ContractsViewed { get; set; }
    public int NotesCreated { get; set; }
    public int ListsBuilt { get; set; }
    public int PlantingIntentionsAdded { get; set; }
    public int ProducerDetailsViewed { get; set; }
    public int CallClicks { get; set; }
    public int EmailClicks { get; set; }
}
