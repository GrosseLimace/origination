using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models;

public class UpdateCustomerRequest
{
    [StringLength(200)] public string? Location { get; set; }
    [StringLength(20)]  public string? Phone { get; set; }
    [StringLength(100)] public string? Email { get; set; }
    public List<string>? FarmIds { get; set; }
    public List<string>? LinkedProducerIds { get; set; }
}
