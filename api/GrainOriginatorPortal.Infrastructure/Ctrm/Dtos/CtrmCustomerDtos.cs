using System.Text.Json;

namespace GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

/// <summary>
/// A CTRM customer master record, limited to the fields the API team confirmed on 2026-10-05, plus the
/// extended fields of plan E1 (filled only when <c>CustomerSync:CtrmExtendedFields</c> sends them).
/// </summary>
/// <remarks>
/// <see cref="Id"/> is a <see cref="JsonElement"/> because its GraphQL type (number or string) is not
/// yet known and must never be assumed; use <see cref="IdText"/>. <see cref="MdmMasterRecord"/> is a
/// <see cref="JsonElement"/> for the same reason (bool or "Y"/"N") — read it through
/// <see cref="CtrmYesNo.IsYes"/>. <see cref="NopidNo"/> likewise (the capability check lists field names,
/// not types, and a number would otherwise fail the whole read) — read it through <see cref="NopidNoText"/>.
/// </remarks>
public sealed class CtrmCustomerDto
{
    public JsonElement Id { get; set; }
    public string? Code { get; set; }
    public string? Name { get; set; }
    public string? SourceCode { get; set; }
    public string? SourceSystem { get; set; }
    public string? ActiveYN { get; set; }
    public string? MerchandisingName { get; set; }
    public string? MerchandisingAddressLine1 { get; set; }
    public string? MerchandisingAddressLine2 { get; set; }
    public string? MerchandisingCity { get; set; }
    public string? MerchandisingStateProvince { get; set; }
    public string? MerchandisingPostalCode { get; set; }
    public string? MerchandisingCountry { get; set; }
    public string? MerchandisingPhone { get; set; }
    public string? IndustryCode1 { get; set; }
    public string? IndustryCode2 { get; set; }
    public string? IndustryCode3 { get; set; }
    public JsonElement MdmMasterRecord { get; set; }

    /// <summary>Kept as text on purpose — the format is unverified.</summary>
    public string? LastChangedUtc { get; set; }

    // Extended fields (plan E1/E2) — null unless the extended projection was sent.
    public string? MerchandisingEmail { get; set; }
    public string? ExtendedPrimaryPhone { get; set; }
    public string? SupplementalEmail { get; set; }
    public string? ExtendedAddressLine1 { get; set; }
    public string? ExtendedAddressLine2 { get; set; }
    public string? ExtendedAddressLine3 { get; set; }
    public string? ExtendedAddressLine4 { get; set; }
    public string? ExtendedCity { get; set; }
    public string? ExtendedStateProvince { get; set; }
    public string? ExtendedPostalCode { get; set; }
    public string? ExtendedCountry { get; set; }
    public JsonElement NopidNo { get; set; }
    public string? PaymentMethod { get; set; }

    public string IdText => Id.ValueKind switch
    {
        JsonValueKind.String => Id.GetString() ?? "",
        JsonValueKind.Number => Id.GetRawText(),
        _ => "",
    };

    /// <summary><see cref="NopidNo"/> as text (string or number); null when absent or null. Not normalised.</summary>
    public string? NopidNoText => NopidNo.ValueKind switch
    {
        JsonValueKind.String => NopidNo.GetString(),
        JsonValueKind.Number => NopidNo.GetRawText(),
        _ => null,
    };
}

/// <summary>Reads the CTRM yes/no flags, which arrive as a bool, "Y"/"N" or 1/0.</summary>
public static class CtrmYesNo
{
    public static bool IsYes(JsonElement e) =>
        e.ValueKind == JsonValueKind.True
        || (e.ValueKind == JsonValueKind.String && e.GetString() is { } s
            && (s.Trim().Equals("Y", StringComparison.OrdinalIgnoreCase)
                || s.Trim().Equals("YES", StringComparison.OrdinalIgnoreCase)
                || s.Trim() == "1"))
        || (e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var n) && n == 1);
}

public sealed class CtrmContractLinkDto
{
    public string? CustomerId { get; set; }
    public string? TradeUnit { get; set; }
}

public sealed class CtrmContractLinksResponse
{
    public CtrmPage<CtrmContractLinkDto>? Contracts { get; set; }
}

public sealed class CtrmTicketLinkDetailDto
{
    public string? CustomerCode { get; set; }
    public string? OrganizationCode { get; set; }
}

public sealed class CtrmTicketLinkDto
{
    public List<CtrmTicketLinkDetailDto> Details { get; set; } = [];
}

public sealed class CtrmTicketLinksResponse
{
    public CtrmPage<CtrmTicketLinkDto>? Tickets { get; set; }
}
