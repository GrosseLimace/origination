using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm.Dtos;

/// <summary>Envelope for the splits root field. PLACEHOLDER: field names unconfirmed, see <see cref="CtrmQueries.SplitsByCustomer"/>.</summary>
public sealed class CtrmSplitsResponse
{
    public CtrmPage<CtrmSplitDto>? CustomerSplits { get; set; }
}

/// <summary>One split row. PLACEHOLDER: named after the CTRM Customer Splits Inquiry screen, not the API.</summary>
public sealed class CtrmSplitDto
{
    public string? SplitCustomerId { get; set; }
    public string? PrimaryCustomerId { get; set; }
    public string? Name { get; set; }
    public decimal? SplitPercent { get; set; }
    public DateTime? EffectiveDate { get; set; }
    public bool? Expired { get; set; }
    /// <summary>"BIN" for a bin site; anything else is a field.</summary>
    public string? SiteType { get; set; }
}
