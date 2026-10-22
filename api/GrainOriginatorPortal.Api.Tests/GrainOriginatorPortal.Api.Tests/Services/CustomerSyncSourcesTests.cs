// Microsoft namespaces
using Microsoft.Extensions.Configuration;

// Third-party namespaces
using Xunit;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers how <c>CustomerSync:Source</c> picks the sync feeder. Same table as
/// <c>ContractRepositorySwitchTests</c>: only the literal <c>ctrm</c> opts in; anything else is ODS.
/// </summary>
public class CustomerSyncSourcesTests
{
    private static IConfiguration Config(string? source)
    {
        var values = new Dictionary<string, string?>();
        if (source is not null) values[CustomerSyncSources.ConfigKey] = source;
        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    [Theory]
    [InlineData(null)]     // key absent entirely
    [InlineData("")]       // the shipped default in base appsettings
    [InlineData("ods")]    // explicit ODS
    [InlineData("ctrmm")]  // near miss — must NOT opt in
    [InlineData("graphql")]
    public void Resolve_AnythingOtherThanCtrm_IsOds(string? v)
    {
        Assert.Equal(CustomerSyncSources.Ods, CustomerSyncSources.Resolve(Config(v)));
    }

    [Theory]
    [InlineData("ctrm")]
    [InlineData("CTRM")]
    [InlineData("  ctrm  ")]
    public void Resolve_TheExplicitOptIn_IsCtrm(string v)
    {
        Assert.Equal(CustomerSyncSources.Ctrm, CustomerSyncSources.Resolve(Config(v)));
    }
}
