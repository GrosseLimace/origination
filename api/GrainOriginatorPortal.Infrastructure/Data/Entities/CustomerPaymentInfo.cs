namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Minimal read-only projection of base.Customer — just the CustomerId + PaymentMethod (+ IsCurrent
/// filter). PaymentMethod is not exposed by the curated ODS customer views, so ACH status
/// (PaymentMethod == 'H') is enriched onto Customer at read time straight from the base table,
/// keyed on CustomerId (== dbo.Customer.Id).
/// </summary>
public class CustomerPaymentInfo
{
    public long CustomerId { get; set; }
    public string? PaymentMethod { get; set; }
    public bool IsCurrent { get; set; }
}
