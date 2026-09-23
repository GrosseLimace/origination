// System namespaces
using System.Text.Json;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Pins the wire contract for the certification feed: the exact JSON field spellings the sender
/// uses must bind to the request DTO.
///
/// WHY THIS EXISTS. The DTO was written from the integration team's written description of the
/// payload, not from a captured message. That is a guess until proven, and the failure mode is
/// nasty in one direction: the DTO carries
/// [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Skip)] so that the sender can add fields
/// without breaking us — which also means a field we spell WRONG is silently ignored rather than
/// rejected. A misspelled optional field stores a certification with that value blank and still
/// answers "accepted": true. The sender's logs show success, ours show success, and the hollow
/// record is only noticed when someone opens a producer profile.
///
/// Required fields do not have this problem — they fail validation loudly — so the assertions that
/// earn their keep here are the OPTIONAL ones.
///
/// WHEN A REAL SAMPLE ARRIVES: replace the JSON below with it verbatim, then run this. Anything
/// that comes back null is a field we named wrong. That is the whole point — this test turns an
/// invisible assumption into a visible, checkable one.
/// </summary>
public class OrganicCertificationPayloadContractTests
{
    /// <summary>
    /// Mirrors how ASP.NET Core binds request bodies: AddControllers() seeds its serializer from
    /// JsonSerializerDefaults.Web, which is camelCase AND case-insensitive. The case-insensitivity
    /// is load-bearing here — the integration team documented the key as "nopOperationID" while the
    /// C# property serialises as "nopOperationId", and those differ by one character.
    /// </summary>
    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Field spellings as described by the integration team. NOT yet verified against a captured
    /// message — see the class summary.
    /// </summary>
    private const string SamplePayload = """
    {
      "scoularId": "ABCFARM",
      "operation": {
        "nopOperationID": "1234567890",
        "operationName": "Prairie Ridge Farms",
        "operationOtherNames": "Prairie Ridge",
        "clientOperationId": "PR-0042",
        "certifierName": "Example Certifiers LLC",
        "nopOperationStatus": "Certified",
        "statusEffectiveDate": "2019-03-12",
        "nopAnniversaryDate": "2027-01-01",
        "lastUpdateDate": "2026-09-18",
        "hasCertificate": true,
        "certificateUrl": "https://organic.ams.usda.gov/integrity/example",
        "totalAcreage": 640.5,
        "contactFirstName": "Ignored",
        "contactLastName": "Ignored",
        "phone": "555-0100",
        "email": "ignored@example.com"
      },
      "scopes": [
        { "nopScope": "CROPS", "scopeStatus": "Certified", "statusEffectiveDate": "2019-03-12" }
      ],
      "items": [
        {
          "itemId": "I-1",
          "nopScope": "CROPS",
          "certificateNumber": "C-99",
          "status": "Certified",
          "statusEffectiveDate": "2019-03-12",
          "itemName": "Corn",
          "categoryName": "Grains",
          "categoryId": "G",
          "itemVarieties": "Yellow Dent",
          "otherItems": null,
          "organic": true,
          "organic100": false,
          "madeWithOrganic": false
        }
      ]
    }
    """;

    private static OrganicCertificationIngestRequest Parse(string json) =>
        JsonSerializer.Deserialize<OrganicCertificationIngestRequest>(json, WebOptions)!;

    [Fact]
    public void EveryDocumentedOperationFieldBinds()
    {
        var request = Parse(SamplePayload);

        Assert.Equal("ABCFARM", request.ScoularId);

        var operation = request.Operation;
        Assert.Equal("1234567890", operation.NopOperationId);
        Assert.Equal("Prairie Ridge Farms", operation.OperationName);
        Assert.Equal("Prairie Ridge", operation.OperationOtherNames);
        Assert.Equal("PR-0042", operation.ClientOperationId);
        Assert.Equal("Example Certifiers LLC", operation.CertifierName);

        // The optional fields are the ones worth asserting: a misspelling here is silent.
        Assert.Equal("Certified", operation.NopOperationStatus);
        Assert.Equal(new DateTime(2019, 3, 12), operation.StatusEffectiveDate);
        Assert.Equal(new DateTime(2027, 1, 1), operation.NopAnniversaryDate);
        Assert.Equal(new DateTime(2026, 9, 18), operation.LastUpdateDate);
        Assert.True(operation.HasCertificate);
        Assert.Equal("https://organic.ams.usda.gov/integrity/example", operation.CertificateUrl);
        Assert.Equal(640.5m, operation.TotalAcreage);
    }

    [Fact]
    public void ScopeAndItemFieldsBind()
    {
        var request = Parse(SamplePayload);

        var scope = Assert.Single(request.Scopes!);
        Assert.Equal("CROPS", scope.NopScope);
        Assert.Equal("Certified", scope.ScopeStatus);
        Assert.Equal(new DateTime(2019, 3, 12), scope.StatusEffectiveDate);

        var item = Assert.Single(request.Items!);
        Assert.Equal("I-1", item.ItemId);
        Assert.Equal("CROPS", item.NopScope);
        Assert.Equal("C-99", item.CertificateNumber);
        Assert.Equal("Certified", item.Status);
        Assert.Equal("Corn", item.ItemName);
        Assert.Equal("Grains", item.CategoryName);
        Assert.Equal("G", item.CategoryId);
        Assert.Equal("Yellow Dent", item.ItemVarieties);
        Assert.Null(item.OtherItems);
        Assert.True(item.Organic);
        Assert.False(item.Organic100);
        Assert.False(item.MadeWithOrganic);
    }

    [Fact]
    public void TheKeyIsAcceptedWithTheSendersCasing()
    {
        // The integration team documented "nopOperationID"; the property serialises as
        // "nopOperationId". If binding were case-SENSITIVE this would be null and every message
        // would 400. Asserting it means a future change to the serializer options that turns
        // case-insensitivity off gets caught here rather than in production.
        var request = Parse(SamplePayload);

        Assert.Equal("1234567890", request.Operation.NopOperationId);
    }

    [Fact]
    public void ContactFieldsAreIgnoredRatherThanRejected()
    {
        // Contact PII is present in the source payload and deliberately neither bound nor stored.
        // Under the API-wide UnmappedMemberHandling.Disallow their presence would be a hard error,
        // which is one reason these DTOs opt out. Parsing without throwing IS the assertion.
        var request = Parse(SamplePayload);

        Assert.Equal("1234567890", request.Operation.NopOperationId);
        Assert.DoesNotContain(
            typeof(OrganicOperationDto).GetProperties(),
            p => p.Name.Contains("Contact", StringComparison.OrdinalIgnoreCase)
              || p.Name is "Phone" or "Email");
    }

    [Fact]
    public void UnknownFieldsFromTheSenderDoNotBreakTheMessage()
    {
        // The reason for Skip: the sender can add a field without waiting on a deployment here.
        var withNewFields = """
        {
          "scoularId": "ABCFARM",
          "somethingTheyAddedLater": { "nested": [1, 2, 3] },
          "operation": { "nopOperationID": "1234567890", "brandNewField": "value" },
          "items": [{ "itemId": "I-1", "anotherNewOne": true }]
        }
        """;

        var request = Parse(withNewFields);

        Assert.Equal("1234567890", request.Operation.NopOperationId);
        Assert.Equal("I-1", Assert.Single(request.Items!).ItemId);
    }

    [Fact]
    public void ASurrenderedOperationWithNoItemsParses()
    {
        // Surrendered operations arrive with no items at all. Null and empty must both be fine.
        var surrendered = """
        {
          "scoularId": "ABCFARM",
          "operation": {
            "nopOperationID": "1234567890",
            "nopOperationStatus": "Surrendered",
            "statusEffectiveDate": "2026-02-28",
            "nopAnniversaryDate": null
          },
          "scopes": [{ "nopScope": "CROPS", "scopeStatus": "Surrendered" }],
          "items": []
        }
        """;

        var request = Parse(surrendered);

        Assert.Equal("Surrendered", request.Operation.NopOperationStatus);
        Assert.Null(request.Operation.NopAnniversaryDate);
        Assert.Empty(request.Items!);
    }
}
