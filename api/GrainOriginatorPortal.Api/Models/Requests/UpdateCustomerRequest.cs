using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpdateCustomerRequest
{
    [StringLength(500)] public string? Location { get; init; }
    [StringLength(50)]
    [Phone] public string? Phone { get; init; }
    [StringLength(200)]
    [EmailAddress] public string? Email { get; init; }
    public List<string>? FarmIds { get; init; }
    public List<string>? LinkedProducerIds { get; init; }
}
