namespace GrainOriginatorPortal.Models;

public class Ticket
{
    public string Id { get; set; } = string.Empty;
    public string CustomerId { get; set; } = string.Empty;
    public string FarmId { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public string Crop { get; set; } = string.Empty;
    public int GrossWeight { get; set; }
    public int TareWeight { get; set; }
    public int NetWeight { get; set; }
    public decimal Moisture { get; set; }
    public decimal TestWeight { get; set; }
}