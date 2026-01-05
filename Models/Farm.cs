namespace GrainOriginatorPortal.Models;

public class Farm
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public int Acres { get; set; }
    public int? BinStorageCapacity { get; set; }
}