// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Pins the producer-code preparation shared by the CTRM contract and ticket readers.
/// </summary>
/// <remarks>
/// <para>The length limit is a measured value, not a convention: against live QA a 7-character code
/// returns data and an 8-character one answers <c>"An internal error occurred"</c> for the WHOLE
/// <c>customerIds</c> request, so a single bad code takes down every producer sharing the chunk. That is
/// why <see cref="CtrmCustomerCodes.Normalize"/> drops rather than trusts.</para>
///
/// <para><see cref="CtrmCustomerCodes.NormalizeKeepingAll"/> exists because the dropping overload was
/// once used on a caller that does NOT hit that filter, and an over-length producer silently vanished
/// from a trade unit. These tests keep the two overloads from converging back into one.</para>
/// </remarks>
public class CtrmCustomerCodesTests
{
    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("12345")]   // shortest real ScoularId
    [InlineData("123456")]
    [InlineData("1234567")] // exactly MaxLength - the last length QA answers with data
    public void Normalize_KeepsCodesUpToMaxLength_BecauseTheFilterAnswersThemWithData(string code)
    {
        var result = CtrmCustomerCodes.Normalize([code], out var dropped);

        Assert.Equal([code], result);
        Assert.Empty(dropped);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("12345678")] // one past MaxLength - the length that fails the whole request
    [InlineData("123456789012")]
    public void Normalize_DropsOverLengthCodes_SoOneBadCodeCannotFailTheWholeChunk(string code)
    {
        var result = CtrmCustomerCodes.Normalize([code], out var dropped);

        Assert.Empty(result);
        Assert.Equal([code], dropped);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Normalize_DropsOnlyTheOffendingCode_AndReportsItSeparatelyForLogging()
    {
        // The good producers in the chunk still have to be readable; the caller logs `dropped`.
        var result = CtrmCustomerCodes.Normalize(["TATOBIN", "WAYTOOLONGCODE", "ABC12"], out var dropped);

        Assert.Equal(["ABC12", "TATOBIN"], result);
        Assert.Equal(["WAYTOOLONGCODE"], dropped);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void NormalizeKeepingAll_KeepsAnOverLengthCode_SoNonFilterCallersDoNotLoseAProducer()
    {
        // The singular `customerId` filter handles a long code fine - dropping here made a producer
        // disappear from a trade unit even on the path that could have read it.
        var result = CtrmCustomerCodes.NormalizeKeepingAll(["TATOBIN", "WAYTOOLONGCODE", "ABC12"]);

        Assert.Equal(["ABC12", "TATOBIN", "WAYTOOLONGCODE"], result);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BothOverloads_TrimSurroundingWhitespace_BeforeTheLengthIsMeasured()
    {
        // Padding must not be counted toward MaxLength, or a valid producer would be dropped.
        var result = CtrmCustomerCodes.Normalize(["  1234567  "], out var dropped);

        Assert.Equal(["1234567"], result);
        Assert.Empty(dropped);
        Assert.Equal(["1234567"], CtrmCustomerCodes.NormalizeKeepingAll([" 1234567\t"]));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Normalize_MeasuresLengthAfterTrimming_SoPaddingCannotHideAnOverLengthCode()
    {
        var result = CtrmCustomerCodes.Normalize(["  12345678  "], out var dropped);

        Assert.Empty(result);
        Assert.Equal(["12345678"], dropped); // reported trimmed, as the API would have seen it
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BothOverloads_DeDuplicateCaseInsensitively_SoOneProducerIsSentOnce()
    {
        var result = CtrmCustomerCodes.Normalize(["tatobin", "TATOBIN", " TaToBiN "], out var dropped);

        Assert.Single(result);
        Assert.Empty(dropped);
        Assert.Single(CtrmCustomerCodes.NormalizeKeepingAll(["tatobin", "TATOBIN"]));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void DeDuplication_KeepsTheCasingOfTheFirstOccurrence()
    {
        // The comparison ignores case but the surviving value is not upper-cased or normalized,
        // so whatever ScoularId arrived first is what gets sent to CTRM.
        Assert.Equal(["tatobin"], CtrmCustomerCodes.Normalize(["tatobin", "TATOBIN"], out _));
        Assert.Equal(["TATOBIN"], CtrmCustomerCodes.Normalize(["TATOBIN", "tatobin"], out _));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BothOverloads_SortCaseInsensitively_SoCallersCanDeriveAnOrderIndependentCacheKey()
    {
        // Ordinal sorting would put every upper-case code ahead of every lower-case one, so two
        // callers passing the same producers in different casing would key different cache entries.
        var result = CtrmCustomerCodes.Normalize(["BRAVO", "alpha", "Charlie"], out _);

        Assert.Equal(["alpha", "BRAVO", "Charlie"], result);
        Assert.Equal(["alpha", "BRAVO", "Charlie"], CtrmCustomerCodes.NormalizeKeepingAll(["Charlie", "BRAVO", "alpha"]));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BothOverloads_ReturnAnEmptySetForNullInput_RatherThanThrowing()
    {
        var result = CtrmCustomerCodes.Normalize(null, out var dropped);

        Assert.Empty(result);
        Assert.Empty(dropped);
        Assert.Empty(CtrmCustomerCodes.NormalizeKeepingAll(null));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BothOverloads_DiscardEmptyWhitespaceOnlyAndNullEntries_SoNoBlankIdIsEverSent()
    {
        IReadOnlyCollection<string> codes = ["TATOBIN", "", "   ", "\t", null!];

        var result = CtrmCustomerCodes.Normalize(codes, out var dropped);

        Assert.Equal(["TATOBIN"], result);
        Assert.Empty(dropped); // blanks are discarded, not reported as over-length
        Assert.Equal(["TATOBIN"], CtrmCustomerCodes.NormalizeKeepingAll(codes));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void BothOverloads_ReturnAnEmptySetWhenEveryEntryIsBlank()
    {
        var result = CtrmCustomerCodes.Normalize(["", "  "], out var dropped);

        Assert.Empty(result);
        Assert.Empty(dropped);
        Assert.Empty(CtrmCustomerCodes.NormalizeKeepingAll(["", "  "]));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void LimitsAreTheMeasuredValues_BecauseADriftingCopyReintroducesTheOutage()
    {
        // MaxLength is the bisected QA boundary; MaxPerCall is the server's ceiling on one
        // customerIds list and is what CtrmTicketReader chunks by.
        Assert.Equal(7, CtrmCustomerCodes.MaxLength);
        Assert.Equal(500, CtrmCustomerCodes.MaxPerCall);
    }
}
