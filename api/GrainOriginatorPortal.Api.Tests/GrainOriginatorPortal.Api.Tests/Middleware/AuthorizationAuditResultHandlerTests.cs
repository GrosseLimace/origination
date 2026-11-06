// System namespaces
using System.Security.Claims;
using System.Text.Json;

// Microsoft namespaces
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Tests.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// A failed [Authorize] check used to come back as an empty 401/403 — the one API error without the
/// standard ApiErrorResponse envelope (audit 2026-11-05). These pin the envelope: AUTH_REQUIRED or
/// ACCESS_DENIED for an ordinary refusal, AUTHZ_PERMISSION_DENIED naming each missing permission, an
/// audit line for each refusal, and a granted request passed straight through untouched.
/// </summary>
public class AuthorizationAuditResultHandlerTests
{
    private static readonly AuthorizationPolicy Policy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();

    private readonly CapturingLogger<AuthorizationAuditResultHandler> _logger = new();

    /// <summary>Stands in for JwtBearer: a challenge sets 401, a forbid sets 403, neither writes a body.</summary>
    private sealed class FakeAuthentication : IAuthenticationService
    {
        public Task ChallengeAsync(HttpContext context, string? scheme, AuthenticationProperties? properties)
        { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; }
        public Task ForbidAsync(HttpContext context, string? scheme, AuthenticationProperties? properties)
        { context.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; }
        public Task<AuthenticateResult> AuthenticateAsync(HttpContext context, string? scheme) => Task.FromResult(AuthenticateResult.NoResult());
        public Task SignInAsync(HttpContext context, string? scheme, ClaimsPrincipal principal, AuthenticationProperties? properties) => Task.CompletedTask;
        public Task SignOutAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => Task.CompletedTask;
    }

    private static DefaultHttpContext Context()
    {
        var ctx = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddSingleton<IAuthenticationService, FakeAuthentication>().BuildServiceProvider(),
        };
        ctx.Response.Body = new MemoryStream();
        ctx.Items[CorrelationIdMiddleware.ItemsKey] = "trace-123";
        ctx.Request.Path = "/api/customers/9";
        return ctx;
    }

    private static async Task<ApiErrorResponse?> Body(HttpContext ctx)
    {
        ctx.Response.Body.Seek(0, SeekOrigin.Begin);
        return await JsonSerializer.DeserializeAsync<ApiErrorResponse>(ctx.Response.Body, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }

    private static AuthorizationAuditResultHandler Sut() => new(NullLogger<AuthorizationAuditResultHandler>.Instance);

    /// <summary>A signed-in originator posting a note, refused for the given requirements.</summary>
    private async Task<DefaultHttpContext> ForbidAsync(params IAuthorizationRequirement[] failed)
    {
        var ctx = Context();
        ctx.User = TestUsers.Person("Originator");
        ctx.Request.Method = HttpMethods.Post;
        ctx.Request.Path = "/api/notes";

        await new AuthorizationAuditResultHandler(_logger).HandleAsync(
            _ => Task.CompletedTask,
            ctx,
            Policy,
            PolicyAuthorizationResult.Forbid(AuthorizationFailure.Failed(failed)));
        return ctx;
    }

    [Fact]
    public async Task NotSignedIn_Returns401WithTheStandardEnvelope()
    {
        var ctx = Context();

        await Sut().HandleAsync(_ => Task.CompletedTask, ctx, Policy, PolicyAuthorizationResult.Challenge());

        Assert.Equal(StatusCodes.Status401Unauthorized, ctx.Response.StatusCode);
        var body = await Body(ctx);
        Assert.NotNull(body);
        Assert.Equal("AUTH_REQUIRED", body!.Error.Code);
        Assert.Equal("trace-123", body.Error.TraceId);
        Assert.Equal("/api/customers/9", body.Error.Instance);
        Assert.False(string.IsNullOrWhiteSpace(body.Error.Timestamp));
    }

    [Fact]
    public async Task SignedInButRefused_Returns403WithTheStandardEnvelope_AndTheWordingUsersAlreadySee()
    {
        var ctx = Context();

        await Sut().HandleAsync(_ => Task.CompletedTask, ctx, Policy, PolicyAuthorizationResult.Forbid());

        Assert.Equal(StatusCodes.Status403Forbidden, ctx.Response.StatusCode);
        var body = await Body(ctx);
        Assert.Equal("ACCESS_DENIED", body!.Error.Code);
        // Same text as the client's fallback in api.service.ts, so the toast doesn't change.
        Assert.Equal("Access denied: you are not authorized for this resource.", body.Error.Message);
        Assert.Equal("trace-123", body.Error.TraceId);
    }

    [Fact]
    public async Task Granted_RunsTheRequestAndWritesNothing()
    {
        var ctx = Context();
        var ran = false;

        await Sut().HandleAsync(_ => { ran = true; return Task.CompletedTask; }, ctx, Policy, PolicyAuthorizationResult.Success());

        Assert.True(ran);
        Assert.Equal(StatusCodes.Status200OK, ctx.Response.StatusCode);
        Assert.Equal(0, ctx.Response.Body.Length);
    }

    [Fact]
    public async Task AMissingPermission_Gets403WithTheErrorEnvelope_NamingThePermission()
    {
        var ctx = await ForbidAsync(new PermissionRequirement(AppPermissions.Engagement.NotesWrite));

        Assert.Equal(StatusCodes.Status403Forbidden, ctx.Response.StatusCode);
        var error = (await Body(ctx))!.Error;
        Assert.Equal("AUTHZ_PERMISSION_DENIED", error.Code);
        var detail = Assert.Single(error.Details!);
        Assert.Equal("permission", detail.Field);
        Assert.Equal(AppPermissions.Engagement.NotesWrite, detail.Code);
        Assert.Equal("trace-123", error.TraceId);
        Assert.Equal("/api/notes", error.Instance);
    }

    [Fact]
    public async Task EveryMissingPermission_IsNamed_AndLoggedAsASecurityEvent()
    {
        // A read permission on the controller and a write permission on the action, both missing.
        var ctx = await ForbidAsync(
            new PermissionRequirement(AppPermissions.Engagement.NotesWrite),
            new PermissionRequirement(AppPermissions.Engagement.NotesRead));

        var error = (await Body(ctx))!.Error;
        Assert.Equal(new[] { "notes:read", "notes:write" }, error.Details!.Select(d => d.Code));

        var logged = _logger.Audit("AUTHZ_PERMISSION_DENIED");
        Assert.Equal(LogLevel.Warning, logged.Level);
        Assert.Equal("Security", logged.Fields["ErrorCategory"]);
        Assert.Equal(new[] { "notes:read", "notes:write" }, (IEnumerable<string>)logged.Fields["RequiredPermissions"]!);
    }

    [Fact]
    public async Task AnyOther403_GetsTheAccessDeniedEnvelope_WithNoPermissionNamed_AndTheAccessDeniedLog()
    {
        var ctx = await ForbidAsync(new RolesAuthorizationRequirement(["Admin"]));

        Assert.Equal(StatusCodes.Status403Forbidden, ctx.Response.StatusCode);
        var error = (await Body(ctx))!.Error;
        Assert.Equal("ACCESS_DENIED", error.Code);
        Assert.Null(error.Details);
        _logger.Audit("ACCESS_DENIED");
        Assert.DoesNotContain(_logger.Entries, e => Equals(e.Fields.GetValueOrDefault("ErrorCode"), "AUTHZ_PERMISSION_DENIED"));
    }
}
