using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// GraphQL documents for reading customers and the contract / ticket links that tie them to trade units.
/// </summary>
/// <remarks>
/// <para><b>No '#' anywhere in any document.</b> The Application Gateway WAF in front of this API
/// rejects request bodies containing '#' (read as a SQL comment sequence) with an HTML 403 the API
/// never sees. Explain things in C# comments outside the string.</para>
///
/// <para><see cref="CustomerProjection"/> names ONLY fields the API team confirmed on 2026-10-05. An
/// unknown field makes the whole query fail with HTTP 400, so a test pins the exact string.</para>
///
/// <para><see cref="ExtendedCustomerProjection"/> (plan E1) adds <see cref="ExtendedFieldsProjection"/> - the
/// fields <c>GET /api/diagnostics/customer-sync/ctrm-capabilities</c> listed on nonprod on 2026-10-06 - and is
/// sent only when <c>CustomerSync:CtrmExtendedFields</c> is on (see <see cref="CtrmCustomerReader.ExtendedFieldsKey"/>).
/// Both the aliased and the <c>sourceCodes</c> document come in a base and an extended form; a test pins both
/// strings.</para>
///
/// <para><c>id</c> and <c>mdmMasterRecord</c> are mapped to <c>JsonElement</c> in the DTO because
/// their GraphQL types (number vs string, bool vs "Y"/"N") are unverified.</para>
/// </remarks>
public static class CtrmCustomerQueries
{
    public const string CustomerProjection = "id code name sourceCode sourceSystem activeYN merchandisingName merchandisingAddressLine1 merchandisingAddressLine2 merchandisingCity merchandisingStateProvince merchandisingPostalCode merchandisingCountry merchandisingPhone industryCode1 industryCode2 industryCode3 mdmMasterRecord lastChangedUtc";

    /// <summary>
    /// The extra Customer fields of plan E1/E2: email, the extended (primary) address and phone, the NOP id and
    /// the payment method. Present on nonprod per the 2026-10-06 capability check; NOT yet probed on PROD's API,
    /// which is why they sit behind <c>CustomerSync:CtrmExtendedFields</c>. <c>duplicateYN</c> also exists but is
    /// read only by the add-customer search (E3), so it is deliberately absent.
    /// </summary>
    public const string ExtendedFieldsProjection = "merchandisingEmail extendedPrimaryPhone supplementalEmail extendedAddressLine1 extendedAddressLine2 extendedAddressLine3 extendedAddressLine4 extendedCity extendedStateProvince extendedPostalCode extendedCountry nopidNo paymentMethod";

    /// <summary><see cref="CustomerProjection"/> followed by <see cref="ExtendedFieldsProjection"/>.</summary>
    public const string ExtendedCustomerProjection = CustomerProjection + " " + ExtendedFieldsProjection;

    /// <summary>The projection for the mode: <see cref="ExtendedCustomerProjection"/> when <paramref name="extended"/>, else <see cref="CustomerProjection"/>.</summary>
    public static string Projection(bool extended) => extended ? ExtendedCustomerProjection : CustomerProjection;

    /// <summary>
    /// Rows requested per source code. A code with more than five MDM rows is a data problem the
    /// duplicate counter should surface, not something to page through.
    /// </summary>
    public const int TakePerCode = 5;

    // Relaxed escaping keeps an apostrophe literal ("O'HARA1") instead of 0027; still a valid GraphQL string.
    private static readonly JsonSerializerOptions StringOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public const string CustomersProbe = "query { customers(skip: 0, take: 1) { totalCount items { sourceCode activeYN } } }";

    /// <summary>
    /// One aliased <c>customers(sourceCode:)</c> field per code; codes are JSON-serialised, never interpolated raw.
    /// Every alias carries <see cref="Projection"/> for <paramref name="extended"/>.
    /// </summary>
    public static string CustomersBySourceCodesAliased(IReadOnlyList<string> codes, string? sourceSystem, bool extended = false)
    {
        ArgumentNullException.ThrowIfNull(codes);
        if (codes.Count == 0)
        {
            throw new ArgumentOutOfRangeException(nameof(codes), "At least one source code is required.");
        }

        var systemArgument = string.IsNullOrWhiteSpace(sourceSystem)
            ? string.Empty
            : $", sourceSystem: {JsonSerializer.Serialize(sourceSystem, StringOptions)}";

        var projection = Projection(extended);
        var builder = new StringBuilder("query {\n");
        for (var i = 0; i < codes.Count; i++)
        {
            builder.Append("  c").Append(i)
                .Append(": customers(skip: 0, take: ").Append(TakePerCode)
                .Append(", sourceCode: ").Append(JsonSerializer.Serialize(codes[i], StringOptions))
                .Append(systemArgument)
                .Append(") { totalCount items { ").Append(projection).Append(" } }\n");
        }
        builder.Append('}');
        return builder.ToString();
    }

    /// <summary>
    /// The bulk lookup (E7, the default strategy): one <c>customers(sourceCodes:)</c> list filter, paged with
    /// skip/take. <c>$sourceSystem</c> is sent only when <c>CustomerSync:CtrmSourceSystem</c> is configured;
    /// an argument whose variable is not provided is treated as absent, so no filter is applied.
    /// </summary>
    /// <remarks>
    /// The API limits the RENDERED filter (7,000 encoded characters on Profisee), not the number of values,
    /// so the reader sizes chunks by estimated filter length - see
    /// <see cref="CtrmCustomerReader.ChunkBySourceCodeFilterLength"/>.
    /// </remarks>
    public const string CustomersBySourceCodes = $$"""
        query ($codes: [String!], $sourceSystem: String, $skip: Int, $take: Int) {
          customers(sourceCodes: $codes, sourceSystem: $sourceSystem, skip: $skip, take: $take) {
            totalCount
            pageInfo { hasNextPage }
            items { {{CustomerProjection}} }
          }
        }
        """;

    /// <summary><see cref="CustomersBySourceCodes"/> with <see cref="ExtendedCustomerProjection"/> (plan E1).</summary>
    public const string CustomersBySourceCodesExtended = $$"""
        query ($codes: [String!], $sourceSystem: String, $skip: Int, $take: Int) {
          customers(sourceCodes: $codes, sourceSystem: $sourceSystem, skip: $skip, take: $take) {
            totalCount
            pageInfo { hasNextPage }
            items { {{ExtendedCustomerProjection}} }
          }
        }
        """;

    /// <summary>The <c>sourceCodes</c> document for the mode.</summary>
    public static string CustomersBySourceCodesDocument(bool extended) => extended ? CustomersBySourceCodesExtended : CustomersBySourceCodes;

    public const string ContractLinksInWindow = """
        query ($from: Date!, $to: Date!, $skip: Int, $take: Int) {
          contracts(skip: $skip, take: $take, contractDateFrom: $from, contractDateTo: $to) {
            totalCount
            pageInfo { hasNextPage }
            items { customerId tradeUnit }
          }
        }
        """;

    public const string TicketLinksInWindow = """
        query ($from: Date!, $to: Date!, $skip: Int, $take: Int) {
          tickets(skip: $skip, take: $take, blDateFrom: $from, blDateTo: $to) {
            totalCount
            pageInfo { hasNextPage }
            items { details { customerCode organizationCode } }
          }
        }
        """;
}
