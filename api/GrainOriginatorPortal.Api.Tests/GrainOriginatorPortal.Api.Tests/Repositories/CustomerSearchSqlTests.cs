// Third-party namespaces
using System.Text.RegularExpressions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The customer searches build raw SQL. They are safe because what the user typed only ever travels
/// as a SqlParameter, and the query text is assembled from fixed fragments and generated parameter
/// names. Nothing enforced that, so one careless edit could turn it into an injection. These tests
/// are that enforcement: hostile input goes through both builders and must not reach the text.
/// </summary>
public class CustomerSearchSqlTests
{
    // Each one would change the query if it were pasted into the text.
    private static readonly string[] Hostile =
    [
        "'; DROP TABLE dbo.Customer; --",
        "zz' OR '1'='1",
        "%",
        "_",
        "]",
        "/*x*/",
        "@w0",
        "Robert'); EXEC xp_cmdshell 'dir'--",
        "(402) 555-4914",
    ];

    private static IEnumerable<string> ParameterNamesIn(string sql) =>
        Regex.Matches(sql, @"@[A-Za-z]+\d*").Select(m => m.Value).Distinct();

    [Fact]
    public void CustomerSearch_NeverPutsTypedTextIntoTheQuery()
    {
        var (sql, parameters) = CustomerRepository.BuildSearchSql(Hostile, tradeUnitsCsv: "1084,2001");

        foreach (var word in Hostile.Where(w => w.Length > 3))
            Assert.DoesNotContain(word, sql);
        // Everything typed arrives as a parameter value instead.
        var values = parameters.Select(p => p.Value as string).ToList();
        foreach (var word in Hostile)
            Assert.Contains(word, values);
    }

    [Fact]
    public void OdsSearch_NeverPutsTypedTextIntoTheQuery()
    {
        var (sql, parameters) = CustomerRepository.BuildOdsSearchSql(Hostile);

        foreach (var word in Hostile.Where(w => w.Length > 3))
            Assert.DoesNotContain(word, sql);
        var values = parameters.Select(p => p.Value as string).ToList();
        foreach (var word in Hostile)
            Assert.Contains(word, values);
    }

    [Fact]
    public void EveryParameterTheQueryNamesIsSupplied_AndNoOthers()
    {
        // A mismatch would fail at runtime with "must declare the scalar variable", or leave a value
        // unused; either way it is the sign of an edit that bypassed the parameter list.
        var (sql, parameters) = CustomerRepository.BuildSearchSql(["acme", "(402) 555-4914"], tradeUnitsCsv: "1084");
        var (odsSql, odsParameters) = CustomerRepository.BuildOdsSearchSql(["acme", "4914"]);

        Assert.Equal(
            ParameterNamesIn(sql).Order(),
            parameters.Select(p => p.ParameterName).Order());
        Assert.Equal(
            ParameterNamesIn(odsSql).Order(),
            odsParameters.Select(p => p.ParameterName).Order());
    }

    [Fact]
    public void ThePhoneMatchCompareDigitsOnly_AsAParameter()
    {
        var (sql, parameters) = CustomerRepository.BuildSearchSql(["(402) 555-4914"], tradeUnitsCsv: null);

        Assert.Contains(parameters, p => p.ParameterName == "@d0" && (string)p.Value == "4025554914");
        Assert.Contains("@d0", sql);
        Assert.DoesNotContain("4025554914", sql);
    }

    [Fact]
    public void TheTradeUnitFilterIsAddedOnlyWhenTradeUnitsArePassed()
    {
        var (withTu, withTuParams) = CustomerRepository.BuildSearchSql(["acme"], tradeUnitsCsv: "1084,2001");
        var (withoutTu, withoutTuParams) = CustomerRepository.BuildSearchSql(["acme"], tradeUnitsCsv: null);

        Assert.Contains("@tradeUnits", withTu);
        Assert.Contains(withTuParams, p => p.ParameterName == "@tradeUnits" && (string)p.Value == "1084,2001");
        Assert.DoesNotContain("@tradeUnits", withoutTu);
        Assert.DoesNotContain(withoutTuParams, p => p.ParameterName == "@tradeUnits");
    }
}
