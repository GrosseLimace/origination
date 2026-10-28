// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The caller id arrives from the calling SDK in E.164 ("+14025554914") while producers' numbers are
/// stored however someone typed them. Normalize is the one place the two shapes meet, so each rule
/// is pinned: strip punctuation, drop a US country code, refuse anything too short to be a number.
/// </summary>
public class PhoneDigitsTests
{
    [Theory]
    [InlineData("+14025554914", "4025554914")]   // E.164 as the SDK delivers it
    [InlineData("14025554914", "4025554914")]    // bare 11 digits with the US code
    [InlineData("(402) 555-4914", "4025554914")] // formatted the way the app stores numbers
    [InlineData("402.555.4914", "4025554914")]
    [InlineData("4025554914", "4025554914")]
    [InlineData("5554914", "5554914")]           // 7 digits is the floor
    [InlineData("+44 20 7946 0958", "442079460958")] // non-US: nothing is stripped, 12 digits kept
    public void Normalize_ReducesToMatchableDigits(string raw, string expected)
    {
        Assert.Equal(expected, PhoneDigits.Normalize(raw));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("anonymous")]
    [InlineData("555491")]       // 6 digits: too short to mean anything
    [InlineData("+1 555 49")]
    public void Normalize_RefusesInputTooShortToMatch(string? raw)
    {
        Assert.Null(PhoneDigits.Normalize(raw));
    }

    [Fact]
    public void Normalize_OnlyDropsTheLeadingOneWhenItIsACountryCode()
    {
        // 11 digits starting with 1 is a US number with its country code; 10 digits starting with
        // 1 is not a valid area code but is left alone - we match, we do not validate.
        Assert.Equal("4025554914", PhoneDigits.Normalize("14025554914"));
        Assert.Equal("1025554914", PhoneDigits.Normalize("1025554914"));
    }
}
