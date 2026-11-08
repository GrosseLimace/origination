using System.Text.Json.Serialization;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

/// <summary>
/// A producer's field: one of their CTRM split IDs (combined customer IDs), e.g. TATOB43 "JARBOE WEST".
/// A split is one producer's, so <see cref="SplitId"/> is unique across all producers. Name, split % and
/// effective date come from CTRM, or are typed by hand until CTRM's splits query is live (<see cref="SplitSource"/>);
/// state and county are asked once, for 45Z.
/// Never deleted: a field simply has no season in a year it isn't planted. See
/// docs/application-context/Field Plan - Database Plan.md.
/// </summary>
public class ProducerField
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    /// <summary>Upper-case CTRM split ID, e.g. "TATOB43".</summary>
    public string SplitId { get; set; } = string.Empty;
    /// <summary>The field's name as CTRM had it, e.g. "JARBOE WEST".</summary>
    public string Name { get; set; } = string.Empty;
    public decimal SplitPercent { get; set; }
    public DateOnly? EffectiveDate { get; set; }
    public string? State { get; set; }
    public string? County { get; set; }
    /// <summary>
    /// SPLITS-GRAPHQL: "Manual" when the originator typed the split ID, name and share (go-live, before CTRM's
    /// splits query); "Ctrm" when they came from CTRM. Manual fields are matched to CTRM by split ID once it's live.
    /// </summary>
    public string SplitSource { get; set; } = "Manual";
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }

    [JsonIgnore]
    public Customer? Customer { get; set; }
}
