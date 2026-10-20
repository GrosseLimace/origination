// System namespaces
using System.ComponentModel.DataAnnotations;
using System.Text.Json;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Tests.Models;

/// <summary>
/// Pins the wire contract against the two messages the integration team captured for us on
/// 2026-09-29. These are their real field names, not our reading of a description.
///
/// WHY THIS EXISTS. The first version of the request DTO was built from a written description, and
/// was wrong in seven places — a nested "operation" wrapper that does not exist, plus status,
/// anniversaryDate, lastUpdatedDate, scope, scopeStatus and varieties all misnamed. Only the two
/// REQUIRED fields failed loudly. The rest would have bound as null under
/// JsonUnmappedMemberHandling.Skip, stored blank, and returned "accepted": true with clean logs on
/// both sides. These tests are what found it.
///
/// Keep them honest: if the sender changes the payload, update these from a captured message
/// rather than from an email describing one.
/// </summary>
public class OrganicCertificationPayloadContractTests
{
    /// <summary>
    /// Mirrors how ASP.NET Core binds request bodies: AddControllers() seeds its serializer from
    /// JsonSerializerDefaults.Web — camelCase, case-insensitive, and numbers readable from strings.
    /// </summary>
    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Captured sample 1 — Hofmeyer Farms. Crops + Livestock, and every item is FREE TEXT: no
    /// itemId, no itemName, no category, with the whole crop list in otherItems. An entire
    /// operation in this shape is why itemId cannot be a key.
    /// </summary>
    private const string FreeTextOperation = """
    {
      "scoularId":"PRAI412",
      "nopOperationId":"8150000123",
      "operationName":"Hofmeyer Farms / Dale Hofmeyer",
      "operationOtherNames":null,
      "clientOperationId":null,
      "certifierName":"[MCIA] Minnesota Crop Improvement Association",
      "status":"Certified",
      "statusEffectiveDate":"2012-01-09",
      "anniversaryDate":"2026-04-01",
      "lastUpdatedDate":"2025-11-07",
      "contact":{"firstName":"Dale","lastName":"Hofmeyer","phone":"555-555-0142","email":"dale@example.com","websiteUrl":null},
      "totalAcreage":1503.95,
      "activities":{"broker":false,"distributor":false,"growerGroup":false,"marketerTrader":false,"privateLabeler":false,"dairy":false},
      "scopes":[
        {"scope":"Crops","status":"Certified","statusEffectiveDate":"2012-01-09"},
        {"scope":"Livestock","status":"Certified","statusEffectiveDate":"2012-01-09"}],
      "items":[
        {"scope":"Crops","certificateNumber":null,"status":"Certified","statusEffectiveDate":"2012-01-09","categoryId":null,"categoryName":null,"itemId":null,"itemName":null,"otherItems":"Alfalfa, Corn, CRP, Oats/Alfalfa, Pasture, Rye/Sorghum, Soybeans, Wheat/Alfalfa","varieties":null,"organic100":true,"organic":null},
        {"scope":"Livestock","certificateNumber":null,"status":"Certified","statusEffectiveDate":"2012-01-09","categoryId":null,"categoryName":null,"itemId":null,"itemName":null,"otherItems":"Milk, Dairy Cows (all eligible for organic slaughter), Dairy Replacements (all eligible for organic slaughter)","varieties":null,"organic100":true,"organic":null}],
      "addresses":[
        {"addressType":"Mailing","line1":"1234 Example Rd","line2":null,"city":"Anytown","stateOrProvince":"Minnesota","postalCode":"56000","country":"United States of America (the)","county":null,"countyCode":null}]
    }
    """;

    /// <summary>
    /// Captured sample 2 — Prairie Ridge. Crops + Handling, and a MIX: two catalogued items with
    /// numeric ids and names, plus free-text ones in the same message.
    /// </summary>
    private const string MixedCatalogueOperation = """
    {
      "scoularId":"CEDA118",
      "nopOperationId":"8150000456",
      "operationName":"Prairie Ridge Farms LLC",
      "operationOtherNames":null,
      "clientOperationId":"CL001",
      "certifierName":"[QIMA] QIMA (formerly IBD Certifications)",
      "status":"Certified",
      "statusEffectiveDate":"2008-08-01",
      "anniversaryDate":"2026-07-21",
      "lastUpdatedDate":"2025-10-07",
      "contact":{"firstName":"Dale","lastName":"Hofmeyer","phone":"555-555-0142","email":"dale@example.com","websiteUrl":null},
      "totalAcreage":41281.35,
      "activities":{"broker":false,"distributor":false,"growerGroup":false,"marketerTrader":false,"privateLabeler":false,"dairy":false},
      "scopes":[
        {"scope":"Crops","status":"Certified","statusEffectiveDate":"2008-08-01"},
        {"scope":"Handling","status":"Certified","statusEffectiveDate":"2008-08-01"}],
      "items":[
        {"scope":"Crops","certificateNumber":"US11154/25","status":"Certified","statusEffectiveDate":null,"categoryId":2,"categoryName":"Field/Forageable","itemId":377,"itemName":"Sugercane","otherItems":null,"varieties":null,"organic100":true,"organic":null},
        {"scope":"Crops","certificateNumber":"US11154/25","status":"Certified","statusEffectiveDate":null,"categoryId":2,"categoryName":"Field/Forageable","itemId":363,"itemName":"Soybeans","otherItems":null,"varieties":null,"organic100":true,"organic":null},
        {"scope":"Handling","certificateNumber":"US11154/25","status":"Certified","statusEffectiveDate":null,"categoryId":26,"categoryName":"Condiments and Sweeteners","itemId":583,"itemName":"Sugar","otherItems":null,"varieties":"Cane Sugar","organic100":null,"organic":true},
        {"scope":"Handling","certificateNumber":"US11154/25","status":"Certified","statusEffectiveDate":null,"categoryId":19,"categoryName":"Alcohol","itemId":null,"itemName":null,"otherItems":"Hydrated Ethanol (or Ethyl Hydrated Alcohol)","varieties":null,"organic100":null,"organic":true}],
      "addresses":[
        {"addressType":"Physical","line1":"1234 Example Rd","line2":null,"city":"Anytown","stateOrProvince":"Goias","postalCode":"75000-000","country":"Brazil","county":null,"countyCode":null}]
    }
    """;

    /// <summary>
    /// Captured sample 3 — the first message from the REAL pipeline, dark-run in Dev 2026-10-07
    /// (origination-payload_2230000031_dark-run_2026-10-07.json). The two above were hand-built by
    /// the integration team; this one is what their Logic App actually emits.
    ///
    /// It carries two fields the earlier samples did not: <c>feedRunId</c>, the correlation id
    /// shared by every message in one nightly run (also sent as the X-Correlation-Id header), and
    /// <c>sourceEventTimeUtc</c>. Neither is modelled yet — they bind to nothing and are dropped by
    /// JsonUnmappedMemberHandling.Skip, which is exactly the behaviour that attribute exists for and
    /// is what this sample pins. feedRunId is the answer to our open "where is the batch boundary"
    /// question; modelling it is a separate, additive decision.
    /// </summary>
    private const string PipelineDarkRunOperation = """
    {
      "scoularId":"CEDA118",
      "sourceEventTimeUtc":"2026-10-07T16:27:21.9910000Z",
      "feedRunId":"replay-20261007T162718Z-d3dbb1f3",
      "nopOperationId":"2230000031",
      "operationName":"Goiasa Goiatuba Alcool Ltda",
      "operationOtherNames":null,
      "clientOperationId":"GO001",
      "certifierName":"[IBD] IBD Certifications",
      "status":"Certified",
      "statusEffectiveDate":"2008-08-01",
      "anniversaryDate":"2025-08-30",
      "lastUpdatedDate":"2025-01-29",
      "contact":{"firstName":"Juliana","lastName":"de Fátima Domingos Abdalla","phone":"64 3608-8738","email":"jfdabdalla@goiasa.com.br","websiteUrl":null},
      "totalAcreage":41345.89,
      "activities":{"broker":false,"distributor":false,"growerGroup":false,"marketerTrader":false,"privateLabeler":false,"dairy":false},
      "scopes":[
        {"scope":"Crops","status":"Certified","statusEffectiveDate":"2008-08-01"},
        {"scope":"Handling","status":"Certified","statusEffectiveDate":"2008-08-01"}],
      "items":[
        {"scope":"Handling","certificateNumber":"US9287/24","status":"Certified","statusEffectiveDate":null,"categoryId":26,"categoryName":"Condiments and Sweeteners","itemId":null,"itemName":null,"otherItems":"Organic Cane Sugar (or Brazilian Organic Sugar or Organic Sugar or Cane Sugar Organic)","varieties":null,"organic100":null,"organic":true},
        {"scope":"Handling","certificateNumber":"US9287/24","status":"Certified","statusEffectiveDate":null,"categoryId":19,"categoryName":"Alcohol","itemId":null,"itemName":null,"otherItems":"Neutral Hydrated Ethanol (or Organic Sugar Cane Alcohol or Organic Alcohol or Neutral Organic Alcohol or Neutral Sugar Cane Alcohol or Organic Neutral Alcohol)","varieties":null,"organic100":null,"organic":true},
        {"scope":"Handling","certificateNumber":"US9287/24","status":"Certified","statusEffectiveDate":null,"categoryId":19,"categoryName":"Alcohol","itemId":null,"itemName":null,"otherItems":"Organic Hydrated Ethanol (or Organic Alcohol or Organic Ethyl Hydrated Alcohol or Organic Hydrated Alcohol)","varieties":null,"organic100":null,"organic":true},
        {"scope":"Crops","certificateNumber":"US9287/24","status":"Certified","statusEffectiveDate":null,"categoryId":2,"categoryName":"Field/Forageable","itemId":377,"itemName":"Sugercane","otherItems":null,"varieties":null,"organic100":true,"organic":null}],
      "addresses":[
        {"addressType":"Physical","line1":"Rodovia GO 040 - Km 194, Acesso 7 Km a direita, s/n - Zona Rural.","line2":null,"city":"Goiatuba","stateOrProvince":"Goias","postalCode":"75600-000","country":"Brazil","county":null,"countyCode":null}]
    }
    """;

    private static OrganicCertificationIngestRequest Parse(string json) =>
        JsonSerializer.Deserialize<OrganicCertificationIngestRequest>(json, WebOptions)!;

    private static string Sample(string which) => which switch
    {
        nameof(FreeTextOperation) => FreeTextOperation,
        nameof(MixedCatalogueOperation) => MixedCatalogueOperation,
        nameof(PipelineDarkRunOperation) => PipelineDarkRunOperation,
        _ => throw new ArgumentOutOfRangeException(nameof(which), which, "Unknown sample."),
    };

    [Theory]
    [InlineData(nameof(FreeTextOperation))]
    [InlineData(nameof(MixedCatalogueOperation))]
    [InlineData(nameof(PipelineDarkRunOperation))]
    public void EveryCapturedMessageDeserialises(string which)
    {
        var ex = Record.Exception(() => Parse(Sample(which)));

        Assert.True(ex is null, $"{which} failed to deserialise: {ex?.Message}");
    }

    [Fact]
    public void TheRunIdBindsFromTheRealPayload()
    {
        // feedRunId is modelled as of 2026-10-07 — it is the feed's only batch boundary and the one
        // field that cannot be recovered after the fact. Pinned against the captured message rather
        // than the email describing it, which is the whole point of this file.
        var request = Parse(PipelineDarkRunOperation);

        Assert.Equal("replay-20261007T162718Z-d3dbb1f3", request.FeedRunId);
    }

    [Fact]
    public void FieldsWeDoNotModelAreDroppedRatherThanRejected()
    {
        // sourceEventTimeUtc arrived unannounced with the pipeline's first message, alongside
        // feedRunId. Under the API-wide JsonUnmappedMemberHandling.Disallow an unmodelled field
        // would have made every nightly message a 400 until we shipped a matching DTO; the Skip
        // opt-out on these records is what makes a sender-side addition a non-event. That is the
        // guarantee being pinned — the message still binds completely around the unknown field.
        var request = Parse(PipelineDarkRunOperation);

        Assert.Equal("2230000031", request.NopOperationId);
        Assert.Equal("Goiasa Goiatuba Alcool Ltda", request.OperationName);
        Assert.Equal(4, request.Items!.Count);
    }

    [Fact]
    public void TheRealPipelineMessageBindsItsOperationFields()
    {
        var request = Parse(PipelineDarkRunOperation);

        Assert.Equal("CEDA118", request.ScoularId);
        Assert.Equal("GO001", request.ClientOperationId);
        Assert.Equal("[IBD] IBD Certifications", request.CertifierName);
        Assert.Equal("Certified", request.Status);
        Assert.Equal(new DateTime(2008, 8, 1), request.StatusEffectiveDate);
        Assert.Equal(new DateTime(2025, 8, 30), request.AnniversaryDate);
        Assert.Equal(new DateTime(2025, 1, 29), request.LastUpdatedDate);
        Assert.Equal(41345.89m, request.TotalAcreage);

        // An operation whose every Handling item is free text, with a single catalogued Crops item
        // alongside — both shapes in one message.
        Assert.Equal(3, request.Items!.Count(i => i.ItemId is null && i.OtherItems is not null));
        Assert.Single(request.Items!.Where(i => i.ItemId == 377 && i.ItemName == "Sugercane"));
    }

    [Fact]
    public void TheWidenedTextFieldsAcceptWhatUsdaActuallyHolds()
    {
        // Measured by the integration team across the full USDA set on 2026-10-07: otherItems to
        // 3,996 and varieties to 3,998, against our original 2,000 and 1,000. Validation runs over
        // the whole message, so ONE over-length item rejected that producer's entire certification —
        // every scope and every crop. These are the widths that stop that.
        var item = new OrganicItemDto
        {
            OtherItems = new string('x', 4000),
            Varieties = new string('y', 4000),
            CertificateNumber = new string('z', 255),
        };

        var results = new List<ValidationResult>();
        var valid = Validator.TryValidateObject(item, new ValidationContext(item), results, validateAllProperties: true);

        Assert.True(valid, "Widened item rejected: " + string.Join("; ", results.Select(r => r.ErrorMessage)));
    }

    [Fact]
    public void EveryOperationFieldBinds()
    {
        var request = Parse(MixedCatalogueOperation);

        // Operation fields are FLAT, alongside scoularId — there is no "operation" wrapper.
        Assert.Equal("CEDA118", request.ScoularId);
        Assert.Equal("8150000456", request.NopOperationId);
        Assert.Equal("Prairie Ridge Farms LLC", request.OperationName);
        Assert.Equal("CL001", request.ClientOperationId);
        Assert.Equal("[QIMA] QIMA (formerly IBD Certifications)", request.CertifierName);

        // The optional ones are the ones worth asserting — a misnamed optional binds silently.
        Assert.Equal("Certified", request.Status);
        Assert.Equal(new DateTime(2008, 8, 1), request.StatusEffectiveDate);
        Assert.Equal(new DateTime(2026, 7, 21), request.AnniversaryDate);
        Assert.Equal(new DateTime(2025, 10, 7), request.LastUpdatedDate);
        Assert.Equal(41281.35m, request.TotalAcreage);
    }

    [Fact]
    public void ScopesBindWithTheirOwnStatus()
    {
        var request = Parse(MixedCatalogueOperation);

        var scopes = Assert.IsAssignableFrom<IReadOnlyList<OrganicScopeDto>>(request.Scopes);
        Assert.Equal(2, scopes.Count);

        // Title case in the source — not the upper case an earlier draft of the contract assumed.
        Assert.Equal("Crops", scopes[0].Scope);
        Assert.Equal("Certified", scopes[0].Status);
        Assert.Equal("Handling", scopes[1].Scope);
        Assert.Equal(new DateTime(2008, 8, 1), scopes[1].StatusEffectiveDate);
    }

    [Fact]
    public void CataloguedItemsBindWithNumericIds()
    {
        var request = Parse(MixedCatalogueOperation);

        var item = Assert.Single(request.Items!, i => i.ItemName == "Sugercane");
        Assert.Equal(377, item.ItemId);
        Assert.Equal(2, item.CategoryId);
        Assert.Equal("Field/Forageable", item.CategoryName);
        Assert.Equal("US11154/25", item.CertificateNumber);
        Assert.Equal("Crops", item.Scope);
        Assert.True(item.Organic100);
        Assert.Null(item.Organic);
        Assert.Null(item.OtherItems);
    }

    [Fact]
    public void VarietiesBindsUnderItsOwnName()
    {
        // Named "varieties", not "itemVarieties" — one of the seven the first version got wrong.
        var request = Parse(MixedCatalogueOperation);

        var sugar = Assert.Single(request.Items!, i => i.ItemName == "Sugar");
        Assert.Equal("Cane Sugar", sugar.Varieties);
    }

    [Fact]
    public void FreeTextItemsBindWithNoIdAtAll()
    {
        // The shape that broke the original design. Every item here has itemId, itemName,
        // categoryId and categoryName null, and the crops live in otherItems.
        var request = Parse(FreeTextOperation);

        var items = Assert.IsAssignableFrom<IReadOnlyList<OrganicItemDto>>(request.Items);
        Assert.Equal(2, items.Count);
        Assert.All(items, i =>
        {
            Assert.Null(i.ItemId);
            Assert.Null(i.ItemName);
            Assert.Null(i.CategoryId);
            Assert.NotNull(i.OtherItems);
        });

        Assert.Equal(
            "Alfalfa, Corn, CRP, Oats/Alfalfa, Pasture, Rye/Sorghum, Soybeans, Wheat/Alfalfa",
            items[0].OtherItems);
    }

    [Fact]
    public void FreeTextIsNotReliablyACommaSeparatedList()
    {
        // Guards the display decision. "Oats/Alfalfa" and "Rye/Sorghum" are single entries that
        // contain punctuation, and other operations put whole sentences here. Anything that splits
        // otherItems to build chips will mangle both, so this pins an example that must survive.
        var request = Parse(FreeTextOperation);

        var livestock = Assert.Single(request.Items!, i => i.Scope == "Livestock");
        Assert.Contains("(all eligible for organic slaughter)", livestock.OtherItems);
    }

    [Fact]
    public void ContactActivitiesAndAddressesAreIgnoredRatherThanRejected()
    {
        // All three are present in every real message and none is modelled. Under the API-wide
        // Disallow setting their presence would be a hard error; Skip is what lets them through.
        // Parsing without throwing IS the assertion — plus no contact property exists to bind to.
        var request = Parse(FreeTextOperation);

        Assert.Equal("8150000123", request.NopOperationId);
        Assert.DoesNotContain(
            typeof(OrganicCertificationIngestRequest).GetProperties(),
            p => p.Name is "Contact" or "Activities" or "Addresses" or "Phone" or "Email");
    }

    [Fact]
    public void UnknownFieldsFromTheSenderDoNotBreakTheMessage()
    {
        // The reason for Skip: the sender can extend the payload without waiting on a deployment.
        var withNewFields = """
        {
          "scoularId":"ABCFARM",
          "nopOperationId":"1234567890",
          "somethingTheyAddedLater":{"nested":[1,2,3]},
          "items":[{"itemId":1,"anotherNewOne":true}]
        }
        """;

        var request = Parse(withNewFields);

        Assert.Equal("1234567890", request.NopOperationId);
        Assert.Equal(1, Assert.Single(request.Items!).ItemId);
    }
}
