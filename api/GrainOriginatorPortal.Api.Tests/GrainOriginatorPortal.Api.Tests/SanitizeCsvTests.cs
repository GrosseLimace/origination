using GrainOriginatorPortal.Infrastructure.Data;
using Xunit;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Proves the invariant of <see cref="SqlSanitization.SanitizeCsv"/> — the output is
/// guaranteed to contain only [a-zA-Z0-9-_,] regardless of input. This is the defense
/// that makes it safe to join identifier collections into a SQL statement (B5 / M-003
/// second-order SQL injection finding).
/// </summary>
public class SanitizeCsvTests
{
    [Fact]
    public void StripsSingleQuotesAndInjectionAttempts()
    {
        var input = new[] { "abc'; DROP TABLE Users--" };
        var result = SqlSanitization.SanitizeCsv(input);
        Assert.Equal("abcDROPTABLEUsers--", result); // single quotes, semicolons, spaces all gone (dashes allowed)
    }

    [Fact]
    public void StripsSemicolonsAndParenthesesAndSpaces()
    {
        var input = new[] { "x; EXEC(xp_cmdshell)" };
        var result = SqlSanitization.SanitizeCsv(input);
        Assert.Equal("xEXECxp_cmdshell", result);
    }

    [Fact]
    public void StripsQuotesAndUnionPayload()
    {
        var input = new[] { "1' UNION SELECT * FROM sys.tables" };
        var result = SqlSanitization.SanitizeCsv(input);
        Assert.Equal("1UNIONSELECTFROMsystables", result);
    }

    [Fact]
    public void PreservesNormalTradeUnitCodes()
    {
        var input = new[] { "TU-WIG", "TU_STL", "1234", "ABC" };
        var result = SqlSanitization.SanitizeCsv(input);
        Assert.Equal("TU-WIG,TU_STL,1234,ABC", result);
    }

    [Fact]
    public void EmptyCollectionReturnsEmptyString()
    {
        var result = SqlSanitization.SanitizeCsv(System.Array.Empty<string>());
        Assert.Equal(string.Empty, result);
    }

    [Fact]
    public void MixedValidAndMaliciousStaysComposable()
    {
        var input = new[] { "TU-WIG", "evil'; DROP TABLE--", "TU_STL" };
        var result = SqlSanitization.SanitizeCsv(input);
        // Each element is sanitized independently; comma separators are preserved
        Assert.Equal("TU-WIG,evilDROPTABLE--,TU_STL", result);
    }

    [Fact]
    public void OutputContainsOnlyWhitelistedCharacters()
    {
        // Throw every ASCII character at it — verify output only contains [a-zA-Z0-9-_,]
        var allAscii = new string(Enumerable.Range(0, 128).Select(i => (char)i).ToArray());
        var input = new[] { allAscii };
        var result = SqlSanitization.SanitizeCsv(input);
        Assert.Matches("^[a-zA-Z0-9\\-_,]*$", result);
    }

    [Fact]
    public void StripsUnicodeControlCharacters()
    {
        var input = new[] { "abc\0\r\n\t def" };
        var result = SqlSanitization.SanitizeCsv(input);
        Assert.Equal("abcdef", result);
    }
}
