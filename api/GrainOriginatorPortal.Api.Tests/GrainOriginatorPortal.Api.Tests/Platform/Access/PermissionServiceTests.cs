// System namespaces
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

public class PermissionServiceTests
{
    private readonly IRoleGrantCache _grantCache = Substitute.For<IRoleGrantCache>();
    private readonly CapturingLogger<PermissionService> _logger = new();
    private readonly MemoryCache _memoryCache = new(new MemoryCacheOptions { SizeLimit = 100 });
    private AccessOptions _options = new() { DefaultRoles = ["Originator", "Editor"] };
    private string _environment = "Dev";

    public PermissionServiceTests()
    {
        _grantCache.GetAsync(Arg.Any<CancellationToken>()).Returns(TestGrants.Map());
    }

    private PermissionService For(ClaimsPrincipal user)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(_environment);
        return new PermissionService(
            new ClaimsUserRoleSource(),
            _grantCache,
            new HttpContextAccessor { HttpContext = new DefaultHttpContext { User = user } },
            new FixedOptionsMonitor<AccessOptions>(_options),
            environment,
            _memoryCache,
            _logger);
    }

    private int LogCount(string errorCode) =>
        _logger.Entries.Count(e => Equals(e.Fields.GetValueOrDefault("ErrorCode"), errorCode));

    [Fact]
    public async Task APersonaRole_GrantsItsPermissionsAndSegments_WithNoDefaults()
    {
        var access = await For(TestUsers.Person("Originator")).GetAccessAsync();

        Assert.Equal(new[] { "Originator" }, access.Roles);
        Assert.Equal(TestGrants.Originator.Permissions.Order(), access.Permissions.Order());
        Assert.Equal(new[] { CustomerSegments.Producer }, access.Segments);
        Assert.False(access.UsesDefaultRoles);
    }

    [Fact]
    public async Task RolesOnlyAdd()
    {
        var access = await For(TestUsers.Person("Originator", "Manager")).GetAccessAsync();

        Assert.Equal(TestGrants.Originator.Permissions.Union(TestGrants.Manager.Permissions).Order(), access.Permissions.Order());
        Assert.Equal(new[] { CustomerSegments.Producer }, access.Segments); // add-ons bring no segments
    }

    [Fact]
    public async Task ModulesAreThoseOfTheHeldPermissions()
    {
        var access = await For(TestUsers.Person("Originator")).GetAccessAsync();

        Assert.Equal(new[] { "customers", "engagement", "platform" }, access.Modules.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task APersonWithNoPersonaRole_GetsTheDefaultRoles_LoggedOncePerHour()
    {
        var first = await For(TestUsers.Person()).GetAccessAsync();
        await For(TestUsers.Person()).GetAccessAsync(); // a later request by the same person

        Assert.Equal(new[] { "Editor", "Originator" }, first.Roles.Order(StringComparer.Ordinal));
        Assert.Contains(AppPermissions.Engagement.NotesWrite, first.Permissions);
        Assert.True(first.UsesDefaultRoles);
        Assert.Equal(1, LogCount("ACCESS_DEFAULT_ROLES"));
    }

    [Fact]
    public async Task AnAddOnAlone_IsNotAPersona_SoTheDefaultsAreAddedToIt()
    {
        var access = await For(TestUsers.Person("Manager")).GetAccessAsync();

        Assert.Equal(new[] { "Editor", "Manager", "Originator" }, access.Roles.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Support_IsAPersona_SoITNeverPicksUpTheDefaultEditor()
    {
        var access = await For(TestUsers.Person("Support")).GetAccessAsync();

        Assert.Equal(new[] { "Support" }, access.Roles);
        Assert.DoesNotContain(AppPermissions.Engagement.NotesWrite, access.Permissions);
        Assert.False(access.UsesDefaultRoles);
    }

    [Fact]
    public async Task AnAppOnlyToken_NeverGetsTheDefaults()
    {
        // An app role with no row, and no delegated scope: a machine caller nobody has granted anything.
        var access = await For(TestUsers.Signed(delegated: false, "Origination.Application")).GetAccessAsync();

        Assert.Empty(access.Roles);
        Assert.Empty(access.Permissions);
        Assert.False(access.UsesDefaultRoles);
    }

    [Fact]
    public async Task AMachineRole_GrantsItsPermissions_ToTheAppOnlyToken()
    {
        // The BarChart pipeline: its token's app role has a Machine row that grants bid-feed:manage.
        _grantCache.GetAsync(Arg.Any<CancellationToken>()).Returns(TestGrants.Map([.. TestGrants.All, TestGrants.Pipeline]));

        var access = await For(TestUsers.Signed(delegated: false, "Origination.Application")).GetAccessAsync();

        Assert.Equal(new[] { "Origination.Application" }, access.Roles);
        Assert.Equal(new[] { AppPermissions.BidSheet.BidFeedManage }, access.Permissions);
        Assert.Empty(access.Segments);
        Assert.False(access.UsesDefaultRoles);
    }

    [Fact]
    public async Task WithNoDefaultRolesConfigured_APersonWithNoPersonaGetsNothing()
    {
        _options = new AccessOptions { DefaultRoles = [] };

        var access = await For(TestUsers.Person()).GetAccessAsync();

        Assert.Empty(access.Permissions);
    }

    [Fact]
    public async Task ATokenRoleWithNoRow_GrantsNothing_AndIsLoggedOncePerHour()
    {
        var access = await For(TestUsers.Person("Originator", "Superuser")).GetAccessAsync();
        await For(TestUsers.Person("Originator", "Superuser")).GetAccessAsync();

        Assert.Equal(new[] { "Originator" }, access.Roles);
        Assert.Equal(1, LogCount("ACCESS_UNKNOWN_ROLES"));
    }

    [Fact]
    public async Task TokenRoles_MatchWithoutRegardToCase()
    {
        var access = await For(TestUsers.Person("originator")).GetAccessAsync();

        Assert.Equal(new[] { "Originator" }, access.Roles);
    }

    [Fact]
    public async Task ADefaultRoleWithNoRow_IsLogged()
    {
        _options = new AccessOptions { DefaultRoles = ["Originator", "Editr"] };

        await For(TestUsers.Person()).GetAccessAsync();

        Assert.Equal(1, LogCount("ACCESS_DEFAULT_ROLE_MISSING"));
    }

    [Fact]
    public async Task TheSystemRole_InProduction_LogsASecurityWarningOncePerHour()
    {
        _environment = "Production";

        await For(TestUsers.Person("Admin")).GetAccessAsync();
        await For(TestUsers.Person("Admin")).GetAccessAsync();

        var warning = _logger.Audit("ACCESS_SYSTEM_ROLE_IN_PRODUCTION");
        Assert.Equal(LogLevel.Warning, warning.Level);
        Assert.Equal("jane.doe", warning.Fields["UserId"]);
    }

    [Fact]
    public async Task TheSystemRole_OutsideProduction_IsNotWarnedAbout()
    {
        var access = await For(TestUsers.Person("Admin")).GetAccessAsync();

        Assert.Equal(AppPermissions.All.Order(), access.Permissions.Order());
        Assert.Equal(0, LogCount("ACCESS_SYSTEM_ROLE_IN_PRODUCTION"));
    }

    [Fact]
    public async Task AnAnonymousCaller_GetsNothing_WithoutReadingTheGrants()
    {
        var access = await For(TestUsers.Anonymous()).GetAccessAsync();

        Assert.Same(UserAccess.None, access);
        await _grantCache.DidNotReceive().GetAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AccessIsWorkedOutOncePerRequest()
    {
        var service = For(TestUsers.Person("Originator"));

        Assert.True(await service.HasPermissionAsync(AppPermissions.Engagement.NotesRead));
        Assert.False(await service.HasPermissionAsync(AppPermissions.Engagement.NotesWrite));
        await service.GetAccessAsync();

        await _grantCache.Received(1).GetAsync(Arg.Any<CancellationToken>());
    }
}
