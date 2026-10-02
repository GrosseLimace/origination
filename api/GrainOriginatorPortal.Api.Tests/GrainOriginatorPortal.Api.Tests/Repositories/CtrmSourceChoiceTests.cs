// Microsoft namespaces
using Microsoft.Extensions.Configuration;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The per-user data-source rule that lets a few allow-listed testers compare CTRM against ODS on
/// production data (2026-10-01). The rule is small and the consequences of getting it wrong are not: a
/// user who is NOT on the list must never be able to move their reads off the environment default by
/// sending a header, and a user who IS must get exactly what they asked for.
/// </summary>
public class CtrmSourceChoiceTests
{
    private const string Tester = "CEgr@scoular.com";
    private const string Other = "someone@scoular.com";
    private static readonly IReadOnlyCollection<string> NoTableUsers = [];

    private static IConfiguration Config(string? source = "ods", string? toggleUsers = Tester) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = source,
            ["Ctrm:SourceToggleUsers"] = toggleUsers,
        }).Build();

    // -------------------------------------------------------------------------
    // The routing rule itself: allow-listed + valid preference wins, otherwise the default.
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("ctrm", "ctrm")]
    [InlineData("ods", "ods")]
    [InlineData(" CTRM ", "ctrm")]
    public void AnAllowListedUserGetsThePreferenceTheyAskedFor(string header, string expected)
    {
        Assert.Equal(expected, CtrmSourceChoice.Resolve(Config(source: "ods"), isAllowListed: true, header));
    }

    [Fact]
    public void AnAllowListedUserCanAlsoChooseOds_WhenTheDefaultIsCtrm()
    {
        // The comparison works both ways: in an environment defaulting to CTRM a tester can flip back to ODS.
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ctrm"), isAllowListed: true, "ods"));
    }

    [Theory]
    [InlineData("ctrm")]
    [InlineData("ods")]
    public void AUserNotOnTheList_IsRoutedByTheDefault_WhateverTheySend(string header)
    {
        // The security property. The header is a preference, never an instruction, for anyone else.
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ods"), isAllowListed: false, header));
        Assert.Equal("ctrm", CtrmSourceChoice.Resolve(Config(source: "ctrm"), isAllowListed: false, header));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("graphql")]   // not one of the two known values
    [InlineData("ctrmm")]
    [InlineData("ods; drop")]
    public void AnUnknownPreference_IsNoPreference(string? header)
    {
        // Only the two spellings the switches understand take effect; anything else falls to the default.
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ods"), isAllowListed: true, header));
        Assert.Null(CtrmSourceChoice.Normalise(header));
    }

    // -------------------------------------------------------------------------
    // Who is on the list: the Ctrm:SourceToggleUsers setting OR the dbo.CtrmSourceToggleUsers table.
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("CEgr@scoular.com")]
    [InlineData("cegr@SCOULAR.com")]
    [InlineData("  CEgr@scoular.com  ")]
    public void TheConfigListMatchIsCaseInsensitiveAndTrimmed(string userId)
    {
        Assert.True(CtrmSourceChoice.IsConfiguredToggleUser(Config(toggleUsers: "a@scoular.com, CEgr@scoular.com ;b@scoular.com"), userId));
    }

    [Fact]
    public void TheConfigListIsAnExactMatchPerEntry_NotASubstring()
    {
        // "egr@scoular.com" must not match "CEgr@scoular.com", and vice versa.
        Assert.False(CtrmSourceChoice.IsConfiguredToggleUser(Config(toggleUsers: Tester), "egr@scoular.com"));
        Assert.False(CtrmSourceChoice.IsConfiguredToggleUser(Config(toggleUsers: "egr@scoular.com"), Tester));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AnEmptyConfigListAndEmptyTable_MeansNobodyCanChoose(string? toggleUsers)
    {
        Assert.False(CtrmSourceChoice.IsToggleUser(Config(toggleUsers: toggleUsers), Tester, NoTableUsers));
    }

    [Fact]
    public void TheTableGrantsOnItsOwn_AndMatchesCaseInsensitively()
    {
        var table = new HashSet<string>(["Other@scoular.com", "cegr@scoular.com "], StringComparer.OrdinalIgnoreCase);
        Assert.True(CtrmSourceChoice.IsToggleUser(Config(toggleUsers: ""), "CEgr@scoular.com", table));
        Assert.False(CtrmSourceChoice.IsToggleUser(Config(toggleUsers: ""), "nobody@scoular.com", table));
    }

    [Fact]
    public void EitherHalfOfTheListGrants()
    {
        var table = new HashSet<string>(["table@scoular.com"], StringComparer.OrdinalIgnoreCase);
        var config = Config(toggleUsers: "config@scoular.com");
        Assert.True(CtrmSourceChoice.IsToggleUser(config, "table@scoular.com", table));
        Assert.True(CtrmSourceChoice.IsToggleUser(config, "config@scoular.com", table));
        Assert.False(CtrmSourceChoice.IsToggleUser(config, Other, table));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void AnAnonymousRequest_IsNeverOnTheList(string? userId)
    {
        var table = new HashSet<string>([""], StringComparer.OrdinalIgnoreCase);
        Assert.False(CtrmSourceChoice.IsToggleUser(Config(), userId, table));
    }

    // -------------------------------------------------------------------------
    // The scoped instance the middleware fills in.
    // -------------------------------------------------------------------------

    [Fact]
    public void TheScopedInstance_ReportsWhetherTheUsersChoiceDecided()
    {
        var config = Config(source: "ods");

        var tester = new CtrmSourceChoice();
        tester.Set(Tester, "ctrm", isAllowListed: true);
        Assert.True(tester.CanChoose);
        Assert.True(tester.UsesCtrm(config));
        Assert.True(tester.UserChoiceApplied);

        var testerNoHeader = new CtrmSourceChoice();
        testerNoHeader.Set(Tester, null, isAllowListed: true);
        Assert.True(testerNoHeader.CanChoose);
        Assert.False(testerNoHeader.UsesCtrm(config));
        Assert.False(testerNoHeader.UserChoiceApplied);   // default decided, even for a tester

        var other = new CtrmSourceChoice();
        other.Set(Other, "ctrm", isAllowListed: false);
        Assert.False(other.CanChoose);
        Assert.False(other.UsesCtrm(config));
        Assert.False(other.UserChoiceApplied);

        // An anonymous request can never be allow-listed, whatever the middleware was told.
        var anonymous = new CtrmSourceChoice();
        anonymous.Set(null, "ctrm", isAllowListed: true);
        Assert.False(anonymous.CanChoose);
        Assert.False(anonymous.UsesCtrm(config));

        // The empty instance a background scope gets: no user, no preference, environment default.
        Assert.False(new CtrmSourceChoice().UsesCtrm(config));
        Assert.True(new CtrmSourceChoice().UsesCtrm(Config(source: "ctrm")));
    }

    [Fact]
    public void TheDefaultSourceIsCtrmOnlyForTheLiteralOptIn()
    {
        Assert.Equal("ctrm", CtrmSourceChoice.DefaultSource(Config(source: "ctrm")));
        Assert.Equal("ctrm", CtrmSourceChoice.DefaultSource(Config(source: " CTRM ")));
        Assert.Equal("ods", CtrmSourceChoice.DefaultSource(Config(source: "ods")));
        Assert.Equal("ods", CtrmSourceChoice.DefaultSource(Config(source: "")));
        Assert.Equal("ods", CtrmSourceChoice.DefaultSource(Config(source: null)));
    }
}
