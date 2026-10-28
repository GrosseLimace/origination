namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// A producer whose stored phone number matches an incoming caller id. Several can come back for
/// one number (family members sharing a line), in which case the popup renders a chooser.
/// </summary>
public record IncomingCallMatchResponse
{
    public required long CustomerId { get; init; }
    public required string Name { get; init; }
    /// <summary>Who at the producer the number belongs to, when it is one of the user-entered contacts
    /// (e.g. "Jane Smith"). Null when it matched the producer's own phone. If several contacts share
    /// the number this is the primary / first one; all of them are in <see cref="ContactNames"/>.</summary>
    public string? ContactName { get; init; }
    public List<string> ContactNames { get; init; } = [];
    /// <summary>The customer code shown to users (dbo.Customer.ScoularId).</summary>
    public string? ScoularId { get; init; }
    public string? Location { get; init; }
    public string? StateProvince { get; init; }
    /// <summary>First active trade unit, or null when the producer has no membership rows.</summary>
    public string? TradeUnit { get; init; }
    public List<string> TradeUnits { get; init; } = [];
}
