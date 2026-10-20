// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>The onboarding search document (plan E3): the two aliases, the producer filter, the variables, no '#'.</summary>
public class CtrmCustomerQueriesSearchTests
{
    [Fact]
    public void CustomersSearch_ByNameOnly_DeclaresNoCodeVariable()
    {
        var document = CtrmCustomerQueries.CustomersSearch(byCode: false, extended: false, take: 500);

        Assert.StartsWith("query ($name: String, $sourceSystem: String) {", document);
        Assert.Contains("byName: customers(skip: 0, take: 500, nameContains: $name, industryCode1: \"PR\", sourceSystem: $sourceSystem)", document);
        Assert.DoesNotContain("byCode:", document);
        Assert.DoesNotContain("$code", document);
        Assert.Contains(CtrmCustomerQueries.CustomerProjection + " " + CtrmCustomerQueries.SearchExtraProjection, document);
        Assert.DoesNotContain(CtrmCustomerQueries.ExtendedFieldsProjection, document);
        Assert.DoesNotContain('#', document);
    }

    [Fact]
    public void CustomersSearch_WithCode_AddsTheByCodeAlias_AndTheExtendedProjectionWhenAsked()
    {
        var document = CtrmCustomerQueries.CustomersSearch(byCode: true, extended: true, take: 500);

        Assert.StartsWith("query ($name: String, $sourceSystem: String, $code: String) {", document);
        Assert.Contains("byCode: customers(skip: 0, take: 500, sourceCodeContains: $code, industryCode1: \"PR\", sourceSystem: $sourceSystem)", document);
        Assert.Contains(CtrmCustomerQueries.ExtendedCustomerProjection + " " + CtrmCustomerQueries.SearchExtraProjection, document);
        Assert.Equal(2, document.Split("totalCount items {").Length - 1);
        Assert.DoesNotContain('#', document);
    }

    [Fact]
    public void CustomersSearch_RejectsANonPositiveTake()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CtrmCustomerQueries.CustomersSearch(byCode: false, extended: false, take: 0));
    }
}
