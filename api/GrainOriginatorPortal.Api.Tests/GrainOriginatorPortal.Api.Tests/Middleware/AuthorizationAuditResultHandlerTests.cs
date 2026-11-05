// System namespaces
using System.Security.Claims;
using System.Text.Json;

// Microsoft namespaces
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// A failed [Authorize] check used to come back as an empty 401/403 — the one API error without the
/// standard ApiErrorResponse envelope (audit 2026-11-05). These pin the envelope, and that a granted
/// request is passed straight through untouched.
/// </summary>
public class AuthorizationAuditResultHandlerTests
{
    private static readonly AuthorizationPolicy Policy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();

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
}
