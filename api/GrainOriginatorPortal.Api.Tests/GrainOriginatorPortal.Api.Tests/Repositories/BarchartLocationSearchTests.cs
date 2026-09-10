// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// How the "Add from BarChart" search box turns a phrase into terms.
///
/// The search used to be one Contains of the whole phrase against the elevator name, the site name or
/// the town, one field at a time -- so anything that spanned two columns found nothing. "Alliance
/// Belpre" (company plus town) and "Belpre KS" (town plus state) are both natural ways to look for the
/// same elevator, and both returned an empty list. These cover the parsing that fixes that; the query
/// that consumes the terms is exercised against the live catalog by the picker itself.
/// </summary>
public class BarchartLocationSearchTests
{
    [Fact]
    public void ParseTerms_SplitsOnSpaces_SoWordsCanMatchDifferentColumns()
    {
        var terms = BarchartLocationSearch.ParseTerms("alliance belpre");

        Assert.Equal(["alliance", "belpre"], terms.Select(t => t.Text));
        Assert.All(terms, t => Assert.Null(t.StateCode));
    }

    // Pasted from a spreadsheet or an email, a location reads "Belpre, KS".
    [Theory]
    [InlineData("Belpre, KS")]
    [InlineData("Belpre,KS")]
    [InlineData("Belpre / KS")]
    [InlineData("  Belpre   KS  ")]
    public void ParseTerms_TreatsCommasSlashesAndRunsOfSpaceAsSeparators(string search)
    {
        var terms = BarchartLocationSearch.ParseTerms(search);

        Assert.Equal(["Belpre", "KS"], terms.Select(t => t.Text));
    }

    // The catalog stores two-letter codes, so a search for the spelled-out name matched nothing at all.
    [Theory]
    [InlineData("kansas", "KS")]
    [InlineData("Kansas", "KS")]
    [InlineData("KANSAS", "KS")]
    [InlineData("ks", "KS")]
    [InlineData("Nebraska", "NE")]
    [InlineData("north dakota", "ND")]
    [InlineData("New York", "NY")]
    public void StateCode_ResolvesANameOrACodeToTheStoredCode(string word, string? expected)
    {
        Assert.Equal(expected, BarchartLocationSearch.StateCode(word));
    }

    // Ten states are spelled with two words. Split on the space they would become a text search for
    // sites called "north" and "dakota", which is nothing at all -- so the pair is kept together.
    [Theory]
    [InlineData("north dakota", "ND")]
    [InlineData("South Dakota", "SD")]
    [InlineData("new york", "NY")]
    [InlineData("west virginia", "WV")]
    public void ParseTerms_KeepsATwoWordStateNameTogether(string search, string expected)
    {
        var terms = BarchartLocationSearch.ParseTerms(search);

        var only = Assert.Single(terms);
        Assert.Equal(expected, only.StateCode);
    }

    [Fact]
    public void ParseTerms_FindsATwoWordStateAfterATownAndKeepsBothTerms()
    {
        var terms = BarchartLocationSearch.ParseTerms("fargo north dakota");

        Assert.Equal(["fargo", "north dakota"], terms.Select(t => t.Text));
        Assert.Null(terms[0].StateCode);
        Assert.Equal("ND", terms[1].StateCode);
    }

    // "New" leading something that is not a state stays an ordinary word, or a search for a site in
    // New Haven would collapse into a state filter and lose the town.
    [Fact]
    public void ParseTerms_OnlyPairsWordsThatActuallyNameAState()
    {
        var terms = BarchartLocationSearch.ParseTerms("new haven");

        Assert.Equal(["new", "haven"], terms.Select(t => t.Text));
        Assert.All(terms, t => Assert.Null(t.StateCode));
    }

    // A two-letter word is only a state when it really is one, or "Ag" would filter to Georgia and
    // "Alliance Ag & Grain" would disappear from its own search.
    [Theory]
    [InlineData("ag")]
    [InlineData("grain")]
    [InlineData("llc")]
    [InlineData("belpre")]
    [InlineData("")]
    [InlineData(null)]
    public void StateCode_IsNullForAnythingThatIsNotAState(string? word)
    {
        Assert.Null(BarchartLocationSearch.StateCode(word));
    }

    [Fact]
    public void ParseTerms_MarksTheStateWordWhileLeavingTheRestAlone()
    {
        var terms = BarchartLocationSearch.ParseTerms("belpre kansas");

        Assert.Equal(["belpre", "kansas"], terms.Select(t => t.Text));
        Assert.Null(terms[0].StateCode);
        Assert.Equal("KS", terms[1].StateCode);
    }

    // Each term adds predicates to the query, so a long paste is capped rather than allowed to build
    // arbitrary SQL. Dropping the tail keeps the search working instead of failing it.
    [Fact]
    public void ParseTerms_KeepsTheFirstFewWordsAndDropsTheRest()
    {
        var terms = BarchartLocationSearch.ParseTerms("one two three four five six seven eight");

        Assert.Equal(BarchartLocationSearch.MaxTerms, terms.Count);
        Assert.Equal(["one", "two", "three", "four", "five", "six"], terms.Select(t => t.Text));
    }

    // Repeating a word must not repeat its predicate: every term is ANDed, so "belpre belpre" asking
    // twice costs a second LIKE for no extra selectivity.
    [Fact]
    public void ParseTerms_IgnoresRepeatedWordsWhateverTheirCase()
    {
        var terms = BarchartLocationSearch.ParseTerms("Belpre belpre BELPRE ks");

        Assert.Equal(["Belpre", "ks"], terms.Select(t => t.Text));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(" , / ")]
    public void ParseTerms_IsEmptyWhenNothingWasTyped(string? search)
    {
        Assert.Empty(BarchartLocationSearch.ParseTerms(search));
    }
}
