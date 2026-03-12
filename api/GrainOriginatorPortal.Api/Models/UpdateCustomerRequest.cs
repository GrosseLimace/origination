using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models;

public class UpdateCustomerRequest
{
    [StringLength(500)] public string? Location { get; set; }
    [StringLength(50)]
    [Phone] public string? Phone { get; set; }
    [StringLength(200)]
    [EmailAddress] public string? Email { get; set; }
    public List<string>? FarmIds { get; set; }
    public List<string>? LinkedProducerIds { get; set; }
}
