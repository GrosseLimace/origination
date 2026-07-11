namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Result of summing CalcAcres across a customer's active field tags and writing it to
/// ProducerDetails.TotalAcres.</summary>
public record ApplyCalculatedAcresResponse
{
    public long CustomerId { get; init; }
    public decimal TotalAcres { get; init; }
    public int TagCount { get; init; }
}
