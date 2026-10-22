// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

public class CustomerIdMintingTests
{
    [Fact]
    public void Band_SitsBelowTheSyntheticContractBand() =>
        Assert.True(CustomerIdMinting.ReservedBase + CustomerIdMinting.Span <= CtrmSyntheticId.ReservedBase);

    [Fact]
    public void Band_RoundTripsThroughAJavaScriptNumber() =>
        Assert.True(CustomerIdMinting.ReservedBase + CustomerIdMinting.Span - 1 < 9_007_199_254_740_991L);

    [Theory]
    [InlineData(4_999_999_999_999_999L, false)]
    [InlineData(5_000_000_000_000_000L, true)]
    [InlineData(5_999_999_999_999_999L, true)]
    [InlineData(6_000_000_000_000_000L, false)]
    [InlineData(123456L, false)]
    public void IsMinted_RecognisesOnlyTheBand(long id, bool expected) =>
        Assert.Equal(expected, CustomerIdMinting.IsMinted(id));
}
