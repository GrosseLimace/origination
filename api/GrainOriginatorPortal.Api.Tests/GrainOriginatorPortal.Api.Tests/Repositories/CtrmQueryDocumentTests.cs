// System namespaces
using System.Reflection;
using System.Text.RegularExpressions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Ctrm;
using GrainOriginatorPortal.Infrastructure.Platform.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Structural checks on every GraphQL document this app sends.
/// </summary>
/// <remarks>
/// <para>These exist because the documents are assembled from concatenated <c>const</c> strings, and the
/// compiler is perfectly happy with a seam that produces nonsense. Splitting the contract projection in
/// two once yielded <c>priceMarketMonthDescriptionprices</c> - two valid field names fused into one
/// invalid one - which compiled, passed every unit test, and failed only against the live API. Nothing
/// else in the suite looks at the documents as text.</para>
///
/// <para>Reflection over the consts rather than a hand-written list, so a new document is covered the
/// moment it is added instead of the next time somebody remembers.</para>
/// </remarks>
public class CtrmQueryDocumentTests
{
    /// <summary>The classes that hold CTRM documents: each module keeps its own.</summary>
    private static readonly Type[] QueryClasses =
        [typeof(CtrmContractQueries), typeof(CtrmCustomerQueries), typeof(CtrmSplitQueries)];

    /// <summary>Every string constant on the query classes, public or private.</summary>
    public static TheoryData<string, string> AllDocuments()
    {
        var data = new TheoryData<string, string>();

        foreach (var type in QueryClasses)
        {
            foreach (var field in type
                         .GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
                         .Where(f => f.IsLiteral && f.FieldType == typeof(string))
                         .OrderBy(f => f.Name))
            {
                data.Add($"{type.Name}.{field.Name}", (string)field.GetRawConstantValue()!);
            }
        }

        return data;
    }

    [Fact]
    public void EveryQueryClassIsCovered()
    {
        // A query class added under another module would otherwise go unchecked until someone listed it.
        var found = typeof(CtrmQueries).Assembly.GetTypes()
            .Where(t => t is { IsAbstract: true, IsSealed: true } && t.Name.StartsWith("Ctrm", StringComparison.Ordinal)
                        && t.Name.EndsWith("Queries", StringComparison.Ordinal) && t != typeof(CtrmQueries))
            .OrderBy(t => t.Name)
            .ToList();

        Assert.Equal(QueryClasses.OrderBy(t => t.Name), found);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [MemberData(nameof(AllDocuments))]
    public void NoDocumentContainsAHashComment(string name, string document)
    {
        // The Application Gateway WAF reads '#' as a SQL comment sequence and answers with an HTML 403 the
        // API never sees, so this fails in a way that looks nothing like a query problem.
        Assert.DoesNotContain('#', document);
        Assert.False(string.IsNullOrWhiteSpace(name));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [MemberData(nameof(AllDocuments))]
    public void BracesAreBalanced(string name, string document)
    {
        var depth = 0;
        foreach (var c in document)
        {
            if (c == '{') depth++;
            else if (c == '}') depth--;
            Assert.True(depth >= 0, $"{name} closes a brace it never opened.");
        }

        Assert.Equal(0, depth);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [MemberData(nameof(AllDocuments))]
    public void SubSelectionsAreSeparatedFromTheFieldBeforeThem(string name, string document)
    {
        // The exact bug this class was written for. A sub-selection name fused to the preceding field
        // still yields a syntactically valid document, so only the server rejects it.
        foreach (var subSelection in new[] { "prices", "details", "items", "pageInfo" })
        {
            foreach (var match in Regex.Matches(document, subSelection + @"\s*\{").Cast<Match>())
            {
                if (match.Index == 0) continue;

                var preceding = document[match.Index - 1];
                Assert.True(
                    char.IsWhiteSpace(preceding) || preceding is '{' or '(' or ',',
                    $"{name}: '{subSelection}' is fused to the character '{preceding}' before it — "
                    + "a concatenation seam is missing its separator.");
            }
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TheContractProjectionSeamKeepsItsSeparator()
    {
        // The core field list and the pricing-line block are separate consts joined at run time, so the
        // last field of the first half has to survive the join as its own token. This is the precise
        // failure that shipped: it became "priceMarketMonthDescriptionprices".
        const string lastCoreField = "priceMarketMonthDescription";
        var document = CtrmContractQueries.ContractsByCustomer;

        var index = document.IndexOf(lastCoreField, StringComparison.Ordinal);
        Assert.True(index >= 0, $"The contract projection no longer includes {lastCoreField}.");

        var following = document[index + lastCoreField.Length];
        Assert.True(char.IsWhiteSpace(following),
            $"{lastCoreField} is followed by '{following}' rather than whitespace — "
            + "the projection seam lost its separator.");
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void EveryContractDocumentProjectsTheFieldsTheMappingReads()
    {
        // ToContract reads these; losing one to a bad seam or an edit would null a column on screen
        // rather than fail, which is the harder failure to notice.
        foreach (var document in new[] { CtrmContractQueries.ContractsByCustomer, CtrmContractQueries.ContractsByCustomers, CtrmContractQueries.ContractsByCustomerCore })
        {
            Assert.Contains("contractId", document);
            Assert.Contains("customerId", document);
            Assert.Contains("cropYear", document);
            Assert.Contains("priceTypeCode", document);
            Assert.Contains("priceMarketMonthDescription", document);
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void OnlyThePerProducerContractReadPaysForPricingLines()
    {
        // Pricing lines roughly double a contract page's cost, and a contract LIST never reads them.
        Assert.Contains("prices", CtrmContractQueries.ContractsByCustomer);
        Assert.DoesNotContain("prices", CtrmContractQueries.ContractsByCustomers);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BothTicketDocumentsAskTheServerToExcludeCancelledAndConsolidatedRows()
    {
        foreach (var document in new[] { CtrmContractQueries.TicketsByCustomer, CtrmContractQueries.TicketsByContractNumbers, CtrmContractQueries.TicketsBySplitProducer })
        {
            Assert.Contains("excludeCancelled: true", document);
            Assert.Contains("excludeConsolidated: true", document);
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void OnlyTheFieldPlanTicketReadAsksForTheSplitId()
    {
        // An API without combinedCustomerId answers HTTP 400; on the shared projection that would fail every ticket screen.
        Assert.Contains("customerCode combinedCustomerId", CtrmContractQueries.TicketsBySplitProducer);
        Assert.DoesNotContain("combinedCustomerId", CtrmContractQueries.TicketsByCustomer);
        Assert.DoesNotContain("combinedCustomerId", CtrmContractQueries.TicketsByContractNumbers);
        Assert.DoesNotContain("combinedCustomerId", CtrmContractQueries.TicketsByCustomers);

        // Otherwise the same projection as the shared one, so the mapping reads the same fields.
        Assert.Equal(CtrmContractQueries.TicketsByCustomer, CtrmContractQueries.TicketsBySplitProducer.Replace(" combinedCustomerId", ""));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void EveryDeclaredVariableIsUsedAndEveryUsedVariableIsDeclared()
    {
        // A renamed variable that is still declared silently sends null, which the server reads as "no
        // filter" — on a ticket or contract query that is the difference between one producer and all of them.
        foreach (var (name, document) in AllDocuments().Select(row => ((string)row[0]!, (string)row[1]!)))
        {
            if (!document.TrimStart().StartsWith("query", StringComparison.Ordinal)) continue;

            var header = document[..document.IndexOf('{')];
            var declared = Regex.Matches(header, @"\$(\w+)").Select(m => m.Groups[1].Value).ToHashSet();
            var used = Regex.Matches(document[document.IndexOf('{')..], @"\$(\w+)").Select(m => m.Groups[1].Value).ToHashSet();

            Assert.True(declared.SetEquals(used),
                $"{name}: declared [{string.Join(", ", declared.Order())}] "
                + $"but used [{string.Join(", ", used.Order())}].");
        }
    }
}
