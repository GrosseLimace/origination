// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers how <c>Ctrm:Source</c> routes contract reads. The default has to be ODS for every value
/// except the explicit opt-in, and the flag has to be honoured per call so the two sources can be
/// compared without an API restart.
/// </summary>
public class ContractRepositorySwitchTests
{
    private static ContractRepositorySwitch Sut(IConfiguration config)
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"switch-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"switch-app-{Guid.NewGuid()}").Options);

        var odsRepo = new ContractRepository(ods, app, new Mock<ILogger<ContractRepository>>().Object);

        var provenance = new CtrmProvenance();

        // Every CTRM read goes through the readers: per producer live, trade-unit-wide via the cached
        // producer-set read.
        var reader = new CtrmContractReader(
            new Mock<ICtrmGraphQlClient>().Object,
            config,
            new Mock<ILogger<CtrmContractReader>>().Object);
        var ticketReader = new CtrmTicketReader(
            new Mock<ICtrmGraphQlClient>().Object,
            config,
            new Mock<ILogger<CtrmTicketReader>>().Object);

        var ctrmRepo = new CtrmContractRepository(
            reader, ticketReader, app, odsRepo, provenance, new Mock<ILogger<CtrmContractRepository>>().Object);

        return new ContractRepositorySwitch(odsRepo, ctrmRepo, config, provenance);
    }

    private static IConfiguration Config(string? source)
    {
        var values = new Dictionary<string, string?>();
        if (source is not null) values["Ctrm:Source"] = source;
        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null)]     // key absent entirely
    [InlineData("")]       // the shipped default in base appsettings
    [InlineData("ods")]    // explicit ODS
    [InlineData("ODS")]
    [InlineData("ctrmm")]  // near miss — must NOT opt in
    [InlineData("graphql")]
    public void AnythingOtherThanCtrm_StaysOnOds(string? source)
    {
        // Safe by default: only the literal opt-in moves a read off ODS, so a typo or an empty value
        // cannot silently repoint an environment at the unfamiliar source.
        Assert.False(Sut(Config(source)).UsingCtrm);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("ctrm")]
    [InlineData("CTRM")]
    [InlineData("  ctrm  ")]
    public void TheExplicitOptIn_RoutesToCtrm(string source)
    {
        Assert.True(Sut(Config(source)).UsingCtrm);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TheFlagIsReadPerCall_SoTheSourceCanBeFlippedWithoutARestart()
    {
        // Comparing ODS against CTRM for one producer is the point of the spike; capturing the flag at
        // construction would force a restart between every comparison.
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Ctrm:Source"] = "ods" })
            .Build();
        var sut = Sut(config);

        Assert.False(sut.UsingCtrm);

        config["Ctrm:Source"] = "ctrm";

        Assert.True(sut.UsingCtrm);
    }
}
