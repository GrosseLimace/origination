// System namespaces
using System.Text.Json;

// Microsoft namespaces
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Tests.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// The 403 a caller gets when the framework refuses them: the error envelope for a missing permission,
/// the framework's empty body for anything else, and an audit line either way.
/// </summary>
public class AuthorizationAuditResultHandlerTests
{
    private static readonly AuthorizationPolicy Policy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();

    private readonly CapturingLogger<AuthorizationAuditResultHandler> _logger = new();
    private readonly DefaultHttpContext _context;

    public AuthorizationAuditResultHandlerTests()
    {
        // The default handler forbids through the authentication service. JwtBearer's forbid only sets the status.
        var authentication = Substitute.For<IAuthenticationService>();
        authentication.ForbidAsync(Arg.Any<HttpContext>(), Arg.Any<string?>(), Arg.Any<AuthenticationProperties?>())
            .Returns(call =>
            {
                call.Arg<HttpContext>().Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            });

        _context = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddSingleton(authentication).BuildServiceProvider(),
            User = TestUsers.Person("Originator"),
        };
        _context.Items[CorrelationIdMiddleware.ItemsKey] = "trace-1";
        _context.Request.Method = HttpMethods.Post;
        _context.Request.Path = "/api/notes";
        _context.Response.Body = new MemoryStream();
    }

    private Task ForbidAsync(params IAuthorizationRequirement[] failed) =>
        new AuthorizationAuditResultHandler(_logger).HandleAsync(
            _ => Task.CompletedTask,
            _context,
            Policy,
            PolicyAuthorizationResult.Forbid(AuthorizationFailure.Failed(failed)));

    private async Task<ApiErrorBody> ErrorAsync()
    {
        _context.Response.Body.Position = 0;
        var response = await JsonSerializer.DeserializeAsync<ApiErrorResponse>(
            _context.Response.Body, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return response!.Error;
    }

    [Fact]
    public async Task AMissingPermission_Gets403WithTheErrorEnvelope_NamingThePermission()
    {
        await ForbidAsync(new PermissionRequirement(AppPermissions.Engagement.NotesWrite));

        Assert.Equal(StatusCodes.Status403Forbidden, _context.Response.StatusCode);
        var error = await ErrorAsync();
        Assert.Equal("AUTHZ_PERMISSION_DENIED", error.Code);
        var detail = Assert.Single(error.Details!);
        Assert.Equal("permission", detail.Field);
        Assert.Equal(AppPermissions.Engagement.NotesWrite, detail.Code);
        Assert.Equal("trace-1", error.TraceId);
        Assert.Equal("/api/notes", error.Instance);
    }

    [Fact]
    public async Task EveryMissingPermission_IsNamed_AndLoggedAsASecurityEvent()
    {
        // A read permission on the controller and a write permission on the action, both missing.
        await ForbidAsync(
            new PermissionRequirement(AppPermissions.Engagement.NotesWrite),
            new PermissionRequirement(AppPermissions.Engagement.NotesRead));

        var error = await ErrorAsync();
        Assert.Equal(new[] { "notes:read", "notes:write" }, error.Details!.Select(d => d.Code));

        var logged = _logger.Audit("AUTHZ_PERMISSION_DENIED");
        Assert.Equal(LogLevel.Warning, logged.Level);
        Assert.Equal("Security", logged.Fields["ErrorCategory"]);
        Assert.Equal(new[] { "notes:read", "notes:write" }, (IEnumerable<string>)logged.Fields["RequiredPermissions"]!);
    }

    [Fact]
    public async Task AnyOther403_KeepsTheFrameworksEmptyBody_AndTheAccessDeniedLog()
    {
        await ForbidAsync(new RolesAuthorizationRequirement(["Admin"]));

        Assert.Equal(StatusCodes.Status403Forbidden, _context.Response.StatusCode);
        Assert.Equal(0, _context.Response.Body.Length);
        _logger.Audit("ACCESS_DENIED");
    }
}
