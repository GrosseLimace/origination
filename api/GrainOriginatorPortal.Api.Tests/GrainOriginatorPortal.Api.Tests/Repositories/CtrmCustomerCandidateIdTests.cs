// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Placeholder ids for CTRM onboarding candidates (plan E3/E4): negative, stable per code, distinct across
/// codes, and inside the JavaScript safe-integer range so the client sees the same number the server sent.
/// </summary>
public class CtrmCustomerCandidateIdTests
{
    [Theory]
    [InlineData("TATOBIN")]
    [InlineData("#24FCA")]
    [InlineData("%JACWE")]
    [InlineData("O'HARA1")]
    public void From_IsNegative_AndInsideTheJavaScriptSafeRange(string code)
    {
        var id = CtrmCustomerCandidateId.From(code);

        Assert.True(id < 0);
        Assert.True(-id <= 9_007_199_254_740_991L, "must survive a JSON round trip to a JavaScript number");
        Assert.True(-id >= CtrmCustomerCandidateId.Floor);
        Assert.True(CtrmCustomerCandidateId.IsCandidate(id));
    }

    [Fact]
    public void From_IsStable_AcrossCaseAndPadding()
    {
        Assert.Equal(CtrmCustomerCandidateId.From("TATOBIN"), CtrmCustomerCandidateId.From("  tatobin "));
    }

    [Fact]
    public void From_DiffersBetweenCodes()
    {
        var codes = new[] { "TATOBIN", "TATOB01", "TATOB02", "SMITFAR", "1000FRM", "#24FCA" };
        Assert.Equal(codes.Length, codes.Select(CtrmCustomerCandidateId.From).Distinct().Count());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void From_BlankCode_Throws(string code)
    {
        Assert.Throws<ArgumentException>(() => CtrmCustomerCandidateId.From(code));
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(777L)]
    [InlineData(5_000_000_000_000_042L)]
    public void IsCandidate_IsFalseForRealIds(long id)
    {
        Assert.False(CtrmCustomerCandidateId.IsCandidate(id));
    }
}
