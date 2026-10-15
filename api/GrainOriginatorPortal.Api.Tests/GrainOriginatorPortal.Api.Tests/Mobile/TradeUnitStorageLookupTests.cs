// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile;
using GrainOriginatorPortal.Mobile.Storage;

namespace GrainOriginatorPortal.Api.Tests.Mobile;

/// <summary>Card #648: a trade unit offers storage when any of its producers has DP or storage rows (decided 2026-10-14).</summary>
public class TradeUnitStorageLookupTests
{
    private readonly Mock<IDpContractService> _dp = new();
    private readonly Mock<IStoredGrainService> _storage = new();
    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 100 });

    private TradeUnitStorageLookup Create(params string[] configured) => new(
        _dp.Object, _storage.Object, _cache,
        Options.Create(new MobileOptions { StorageTradeUnits = configured }),
        NullLogger<TradeUnitStorageLookup>.Instance);

    private void DpRows(int count) => _dp
        .Setup(s => s.GetAllAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
        .ReturnsAsync(Enumerable.Range(0, count).Select(_ => new DpContractResponse()).ToList());

    private void StorageRows(int count) => _storage
        .Setup(s => s.GetAllAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
        .ReturnsAsync(Enumerable.Range(0, count).Select(_ => new StoredGrainResponse()).ToList());

    [Fact]
    public async Task ConfiguredTradeUnit_IsYes_WithoutReadingAnyData()
    {
        Assert.True(await Create("2190").OffersStorageAsync("2190", CancellationToken.None));
        _dp.VerifyNoOtherCalls();
        _storage.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task DpRows_AreEnough_AndTheSlowStorageReadIsSkipped()
    {
        DpRows(1);
        Assert.True(await Create().OffersStorageAsync("2190", CancellationToken.None));
        _storage.Verify(s => s.GetAllAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task StorageRows_AloneAreEnough()
    {
        DpRows(0);
        StorageRows(2);
        Assert.True(await Create().OffersStorageAsync("2190", CancellationToken.None));
    }

    [Fact]
    public async Task NoRows_IsNo_AndTheAnswerIsCached()
    {
        DpRows(0);
        StorageRows(0);
        var sut = Create();

        Assert.False(await sut.OffersStorageAsync("2190", CancellationToken.None));
        Assert.False(await sut.OffersStorageAsync("2190", CancellationToken.None));

        _dp.Verify(s => s.GetAllAsync(It.Is<IEnumerable<string>>(t => t.Single() == "2190"), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public void ANo_IsKeptFarShorterThanAYes_BecauseAFailedReadLooksLikeNoRows()
    {
        Assert.True(TradeUnitStorageLookup.NoLifetime <= TimeSpan.FromHours(1));
        Assert.True(TradeUnitStorageLookup.YesLifetime > TradeUnitStorageLookup.NoLifetime);
    }
}
