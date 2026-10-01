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

    private static IConfiguration Config(string? source = "ods", string? toggleUsers = Tester) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = source,
            ["Ctrm:SourceToggleUsers"] = toggleUsers,
        }).Build();

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("ctrm", "ctrm")]
    [InlineData("ods", "ods")]
    [InlineData(" CTRM ", "ctrm")]
    public void AnAllowListedUserGetsThePreferenceTheyAsked_For(string header, string expected)
    {
        Assert.Equal(expected, CtrmSourceChoice.Resolve(Config(source: "ods"), Tester, header));
    }

    [Fact]
    public void AnAllowListedUserCanAlsoChooseOds_WhenTheDefaultIsCtrm()
    {
        // The comparison works both ways: once PROD defaults to CTRM a tester can still flip back to ODS.
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ctrm"), Tester, "ods"));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("ctrm")]
    [InlineData("ods")]
    public void AUserNotOnTheList_IsRoutedByTheDefault_WhateverTheySend(string header)
    {
        // The security property. The header is a preference, never an instruction, for anyone else.
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ods"), Other, header));
        Assert.Equal("ctrm", CtrmSourceChoice.Resolve(Config(source: "ctrm"), Other, header));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AnEmptyAllowList_MeansNobodyCanChoose(string? toggleUsers)
    {
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ods", toggleUsers: toggleUsers), Tester, "ctrm"));
        Assert.False(CtrmSourceChoice.IsToggleUser(Config(toggleUsers: toggleUsers), Tester));
    }

    [Fact]
    public void AnAnonymousRequest_CannotChoose()
    {
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ods"), null, "ctrm"));
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ods"), "", "ctrm"));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("graphql")]   // not one of the two known values
    [InlineData("ctrmm")]
    [InlineData("ods; drop")]
    public void AnUnknownPreference_IsNoPreference(string? header)
    {
        // Only the two spellings the switches understand take effect; anything else falls to the default.
        Assert.Equal("ods", CtrmSourceChoice.Resolve(Config(source: "ods"), Tester, header));
        Assert.Null(CtrmSourceChoice.Normalise(header));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("CEgr@scoular.com")]
    [InlineData("cegr@SCOULAR.com")]
    [InlineData("  CEgr@scoular.com  ")]
    public void TheListMatchIsCaseInsensitiveAndTrimmed(string userId)
    {
        Assert.True(CtrmSourceChoice.IsToggleUser(Config(toggleUsers: "a@scoular.com, CEgr@scoular.com ;b@scoular.com"), userId));
    }

    [Fact]
    public void TheListIsAnExactMatchPerEntry_NotASubstring()
    {
        // "egr@scoular.com" must not match "CEgr@scoular.com", and vice versa.
        Assert.False(CtrmSourceChoice.IsToggleUser(Config(toggleUsers: Tester), "egr@scoular.com"));
        Assert.False(CtrmSourceChoice.IsToggleUser(Config(toggleUsers: "egr@scoular.com"), Tester));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TheScopedInstance_ReportsWhetherTheUsersChoiceDecided()
    {
        var config = Config(source: "ods");

        var tester = new CtrmSourceChoice();
        tester.Set(Tester, "ctrm");
        Assert.True(tester.CanChoose(config));
        Assert.True(tester.UsesCtrm(config));
        Assert.True(tester.UserChoiceApplied(config));

        var testerNoHeader = new CtrmSourceChoice();
        testerNoHeader.Set(Tester, null);
        Assert.True(testerNoHeader.CanChoose(config));
        Assert.False(testerNoHeader.UsesCtrm(config));
        Assert.False(testerNoHeader.UserChoiceApplied(config));   // default decided, even for a tester

        var other = new CtrmSourceChoice();
        other.Set(Other, "ctrm");
        Assert.False(other.CanChoose(config));
        Assert.False(other.UsesCtrm(config));
        Assert.False(other.UserChoiceApplied(config));

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
