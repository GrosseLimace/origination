// System namespaces
using System.Reflection;
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

/// <summary>
/// <c>[RequirePermission]</c> through ASP.NET Core's own authorization service: the policies
/// <see cref="AccessServiceCollectionExtensions.AddAccess"/> registers, the handler, and
/// <see cref="PermissionService"/> over the test grants.
/// </summary>
public class PermissionAuthorizationTests
{
    private readonly IRoleGrantCache _grantCache = Substitute.For<IRoleGrantCache>();
    private readonly HttpContextAccessor _http = new();

    public PermissionAuthorizationTests()
    {
        _grantCache.GetAsync(Arg.Any<CancellationToken>()).Returns(TestGrants.Map());
    }

    private ServiceProvider Services(Action<AuthorizationOptions>? configureLater = null)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(Environments.Development);

        var services = new ServiceCollection()
            .AddLogging()
            .AddMemoryCache()
            .AddSingleton(environment)
            .AddSingleton<IHttpContextAccessor>(_http);
        services.AddAuthorization();
        services.AddAccess(new ConfigurationBuilder().Build());
        services.AddSingleton(_grantCache); // the last registration wins, so this replaces the real cache
        if (configureLater is not null)
        {
            services.Configure(configureLater);
        }

        // Catches a lifetime mistake, such as a singleton handler holding the scoped IPermissionService.
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
    }

    private async Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal caller, string permission, ClaimsPrincipal? about = null)
    {
        await using var provider = Services();
        await using var scope = provider.CreateAsyncScope();
        _http.HttpContext = new DefaultHttpContext { User = caller, RequestServices = scope.ServiceProvider };

        return await scope.ServiceProvider.GetRequiredService<IAuthorizationService>()
            .AuthorizeAsync(about ?? caller, _http.HttpContext, RequirePermissionAttribute.PolicyFor(permission));
    }

    [Fact]
    public void EveryCatalogPermission_HasItsOwnPolicy()
    {
        using var provider = Services();
        var options = provider.GetRequiredService<IOptions<AuthorizationOptions>>().Value;

        Assert.All(AppPermissions.All, permission =>
        {
            var policy = options.GetPolicy(RequirePermissionAttribute.PolicyFor(permission));
            Assert.NotNull(policy);
            Assert.Contains(new PermissionRequirement(permission), policy.Requirements);
        });
    }

    [Fact]
    public void NoPermissionPolicy_IsWeakerThanTheDefault_EvenWhenTheDefaultChangesLater()
    {
        // Set up after AddAccess, as a later change to Program.cs would be.
        var activeUser = new ClaimsAuthorizationRequirement("scp", allowedValues: null);
        using var provider = Services(options => options.DefaultPolicy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .AddRequirements(activeUser)
            .Build());
        var options = provider.GetRequiredService<IOptions<AuthorizationOptions>>().Value;

        Assert.Contains(activeUser, options.DefaultPolicy.Requirements);
        Assert.All(AppPermissions.All, permission =>
        {
            var policy = options.GetPolicy(RequirePermissionAttribute.PolicyFor(permission))!;
            Assert.All(options.DefaultPolicy.Requirements, required => Assert.Contains(required, policy.Requirements));
            Assert.All(options.DefaultPolicy.AuthenticationSchemes, scheme => Assert.Contains(scheme, policy.AuthenticationSchemes));
        });
    }

    [Fact]
    public async Task ACallerHoldingThePermission_IsAllowed()
    {
        var result = await AuthorizeAsync(TestUsers.Person("Originator"), AppPermissions.Engagement.NotesRead);

        Assert.True(result.Succeeded);
    }

    [Fact]
    public async Task ACallerWithoutThePermission_IsRefused_OnThatPermissionAlone()
    {
        var result = await AuthorizeAsync(TestUsers.Person("Originator"), AppPermissions.Engagement.NotesWrite);

        Assert.False(result.Succeeded);
        Assert.Equal(
            new PermissionRequirement(AppPermissions.Engagement.NotesWrite),
            Assert.Single(result.Failure!.FailedRequirements));
    }

    [Fact]
    public async Task AnAnonymousCaller_FailsTheSignInRequirementToo()
    {
        var result = await AuthorizeAsync(TestUsers.Anonymous(), AppPermissions.Engagement.NotesRead);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Failure!.FailedRequirements, r => r is DenyAnonymousAuthorizationRequirement);
    }

    [Fact]
    public async Task AskedAboutSomeoneOtherThanTheCaller_ItRefuses()
    {
        // The caller holds notes:read, but the question is about another principal, which IPermissionService
        // can't answer for.
        var result = await AuthorizeAsync(
            TestUsers.Person("Originator"), AppPermissions.Engagement.NotesRead, about: TestUsers.Person("Admin"));

        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task WhenTheGrantsCantBeLoaded_TheRequestFailsClosedWithA503()
    {
        _grantCache.GetAsync(Arg.Any<CancellationToken>())
            .ThrowsAsync(new InfrastructureException("Access information is temporarily unavailable.", "ACCESS_GRANTS_UNAVAILABLE"));

        var error = await Assert.ThrowsAsync<InfrastructureException>(
            () => AuthorizeAsync(TestUsers.Person("Originator"), AppPermissions.Engagement.NotesRead));

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, error.HttpStatusCode);
    }

    [Fact]
    public void EveryRequirePermission_NamesACatalogPermission()
    {
        // A permission outside the catalog has no policy, so its endpoint would fail with a 500 on first use.
        const BindingFlags declared = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance
            | BindingFlags.Static | BindingFlags.DeclaredOnly;
        var named = typeof(MeController).Assembly.GetTypes()
            .SelectMany(type => type.GetCustomAttributes<RequirePermissionAttribute>(inherit: false)
                .Concat(type.GetMethods(declared).SelectMany(m => m.GetCustomAttributes<RequirePermissionAttribute>(inherit: false)))
                .Select(attribute => (Where: type.Name, attribute.Permission)));

        Assert.All(named, use => Assert.True(
            AppPermissions.All.Contains(use.Permission),
            $"{use.Where} requires '{use.Permission}', which isn't in AppPermissions."));
    }

    [Fact]
    public async Task ThePipelinesAppOnlyToken_PassesThroughItsMachineRole()
    {
        // The BarChart pipeline goes through the same permission policy as a person, by its role row.
        _grantCache.GetAsync(Arg.Any<CancellationToken>()).Returns(TestGrants.Map([.. TestGrants.All, TestGrants.Pipeline]));

        var result = await AuthorizeAsync(
            TestUsers.Signed(delegated: false, "Origination.Application"), AppPermissions.BidSheet.BidFeedManage);

        Assert.True(result.Succeeded);
    }
}
