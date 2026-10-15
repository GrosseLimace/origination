namespace GrainOriginatorPortal.Mobile.Contracts;

/// <summary>Schema <c>CustomerSummary</c> (card #641 search results).</summary>
public sealed record CustomerSummaryDto
{
    public required long Id { get; init; }
    public string? ScoularId { get; init; }
    public required string Name { get; init; }
    public string? Location { get; init; }
    public string? TradeUnit { get; init; }
}

/// <summary>Schema <c>CustomerDetail</c> (cards #641, #642). Contacts carry PII: the client must not cache them.</summary>
public sealed record CustomerDetailDto
{
    public required long Id { get; init; }
    public string? ScoularId { get; init; }
    public required string Name { get; init; }
    public string? Farm { get; init; }
    public string? AddressLine1 { get; init; }
    public string? City { get; init; }
    public string? StateProvince { get; init; }
    public string? PostalCode { get; init; }
    public string? TradeUnit { get; init; }
    public bool ESignEnabled { get; init; }
    /// <summary>The producer's own phone from the master data (as on the desktop profile: phone, else the
    /// extended primary phone). Always sent, alongside any entered contacts. PII: never cached.</summary>
    public string? Phone { get; init; }
    /// <summary>The producer's own email from the master data (email, else the supplemental email). PII.</summary>
    public string? Email { get; init; }
    /// <summary>Contacts entered on the desktop, primary first. PII: never cached.</summary>
    public required IReadOnlyList<ContactDto> Contacts { get; init; }
}

/// <summary>Schema <c>Contact</c>.</summary>
public sealed record ContactDto
{
    public required string Name { get; init; }
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public required bool IsPrimary { get; init; }
}
