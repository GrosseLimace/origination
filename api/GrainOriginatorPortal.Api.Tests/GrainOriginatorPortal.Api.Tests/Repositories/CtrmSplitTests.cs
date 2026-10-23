// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services.Ctrm;
using GrainOriginatorPortal.Infrastructure;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// A producer's CTRM splits: the sample source used until the CTRM query is confirmed, the GraphQL reader
/// waiting behind it, the startup switch between them, and the service the endpoint calls.
/// </summary>
public class CtrmSplitTests
{
    private sealed class SplitsClient : ICtrmGraphQlClient
    {
        public CtrmReadStatus Status { get; set; } = CtrmReadStatus.Ok;
        public List<CtrmSplitDto> Rows { get; } = [];
        public int Calls { get; private set; }
        public bool IsConfigured { get; init; } = true;

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            Calls++;
            Assert.Equal(CtrmQueries.SplitsByCustomer, document);
            if (Status is not (CtrmReadStatus.Ok or CtrmReadStatus.PartialSuccess))
                return Task.FromResult(new CtrmReadResult<T> { Status = Status });
            object value = new CtrmSplitsResponse { CustomerSplits = new CtrmPage<CtrmSplitDto> { Items = [.. Rows] } };
            return Task.FromResult(new CtrmReadResult<T> { Status = Status, Value = (T)value });
        }
    }

    private sealed class FakeRepository : ICtrmSplitRepository
    {
        public CtrmReadResult<IReadOnlyList<CtrmSplit>>? Result { get; init; }
        public string Source => "sample";
        public Task<CtrmReadResult<IReadOnlyList<CtrmSplit>>?> GetByCustomerAsync(long customerId, CancellationToken cancellationToken) =>
            Task.FromResult(Result);
    }

    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value))).Build();

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Sample_BuildsSplitIdsFromTheProducerCode_WithAnExpiredAndABinSplit()
    {
        var read = await new SampleCtrmSplitReader().GetForProducerAsync("tatobin", CancellationToken.None);

        Assert.True(read.Ok);
        var splits = read.Value!;
        Assert.Equal("TATOB01", splits[0].SplitId);
        Assert.Equal("TATOBIN - NORTH 80", splits[0].Name);
        Assert.Equal("NORTH 80", splits[0].FieldName);
        Assert.All(splits, s => Assert.Equal("TATOBIN", s.PrimaryCustomerId));
        Assert.Single(splits, s => s.Kind == CtrmSplitKind.Bin);
        Assert.Single(splits, s => s.Expired);
        Assert.Equal(splits.Count, splits.Select(s => s.SplitId).Distinct().Count());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Reader_MapsRows_AndTakesTheFieldNameAfterTheProducerPrefix()
    {
        var client = new SplitsClient();
        client.Rows.Add(new CtrmSplitDto { SplitCustomerId = " tatob43 ", Name = "T-A TOBIN - JARBOE WEST", SplitPercent = 66.667m, EffectiveDate = new DateTime(2020, 11, 1), SiteType = "FIELD" });
        client.Rows.Add(new CtrmSplitDto { SplitCustomerId = "TATOB44", Name = "T-A TOBIN - BIN", SiteType = "bin", Expired = true });
        client.Rows.Add(new CtrmSplitDto { SplitCustomerId = " " });

        var read = await new CtrmSplitReader(client, Config()).GetForProducerAsync("TATOBIN", CancellationToken.None);

        Assert.True(read.Ok);
        Assert.Equal(2, read.Value!.Count);
        var field = read.Value[0];
        Assert.Equal(("TATOB43", "TATOBIN", "JARBOE WEST", 66.667m, new DateOnly(2020, 11, 1), CtrmSplitKind.Field, false),
            (field.SplitId, field.PrimaryCustomerId, field.FieldName, field.SplitPercent, field.EffectiveDate, field.Kind, field.Expired));
        Assert.Equal((CtrmSplitKind.Bin, true), (read.Value[1].Kind, read.Value[1].Expired));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Reader_CachesAProducersList_ButNeverAFailure()
    {
        var client = new SplitsClient { Status = CtrmReadStatus.EgressBlocked };
        var reader = new CtrmSplitReader(client, Config());

        var failed = await reader.GetForProducerAsync("TATOBIN", CancellationToken.None);
        Assert.Equal(CtrmReadStatus.EgressBlocked, failed.Status);

        client.Status = CtrmReadStatus.Ok;
        client.Rows.Add(new CtrmSplitDto { SplitCustomerId = "TATOB43", Name = "T-A TOBIN - JARBOE WEST" });
        Assert.True((await reader.GetForProducerAsync("TATOBIN", CancellationToken.None)).Ok);
        Assert.True((await reader.GetForProducerAsync("tatobin", CancellationToken.None)).Ok);

        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Reader_SendsNothingWhenCtrmIsNotConfigured()
    {
        var client = new SplitsClient { IsConfigured = false };
        var read = await new CtrmSplitReader(client, Config()).GetForProducerAsync("TATOBIN", CancellationToken.None);
        Assert.Equal(CtrmReadStatus.NotConfigured, read.Status);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null)]
    [InlineData("sample")]
    [InlineData(" Sample ")]
    public void Registration_UsesTheSampleSplitsByDefault(string? source)
    {
        var services = new ServiceCollection();
        DependencyInjection.AddCtrmSplits(services, source is null ? Config() : Config(("Ctrm:SplitsSource", source)));
        Assert.Contains(services, d => d.ServiceType == typeof(ICtrmSplitReader) && d.ImplementationType == typeof(SampleCtrmSplitReader));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("ctrm")]
    [InlineData("ods")]
    public void Registration_RefusesCtrmWhileTheQueryIsAPlaceholder_AndUnknownSources(string source)
    {
        Assert.False(CtrmQueries.SplitsQueryConfirmed);
        Assert.Throws<InvalidOperationException>(() => DependencyInjection.AddCtrmSplits(new ServiceCollection(), Config(("Ctrm:SplitsSource", source))));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Service_ReturnsTheSplitsWithTheirSource()
    {
        var splits = (await new SampleCtrmSplitReader().GetForProducerAsync("TATOBIN", CancellationToken.None)).Value!;
        var service = new ProducerSplitService(new FakeRepository { Result = new() { Status = CtrmReadStatus.Ok, Value = splits } });

        var response = await service.GetByCustomerAsync(1, CancellationToken.None);

        Assert.Equal("sample", response.Source);
        Assert.Equal(splits.Count, response.Splits.Count);
        Assert.Equal(("TATOB01", "NORTH 80", "2018-10-01", "Field"),
            (response.Splits[0].SplitId, response.Splits[0].FieldName, response.Splits[0].EffectiveDate, response.Splits[0].Kind));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Service_IsNotFoundForAProducerWithoutACtrmCode()
    {
        var service = new ProducerSplitService(new FakeRepository { Result = null });
        await Assert.ThrowsAsync<NotFoundException>(() => service.GetByCustomerAsync(1, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Service_FailsRatherThanShowingNoFields_WhenCtrmCantBeRead()
    {
        var service = new ProducerSplitService(new FakeRepository { Result = new() { Status = CtrmReadStatus.Unauthorized } });
        var error = await Assert.ThrowsAsync<InfrastructureException>(() => service.GetByCustomerAsync(1, CancellationToken.None));
        Assert.Contains("Unauthorized", error.Message);
    }
}
