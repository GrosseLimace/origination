// System namespaces
using System.Security.Claims;
using System.Threading.Channels;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Middleware;

namespace GrainOriginatorPortal.Api.Tests.Middleware;

/// <summary>
/// The usage middleware is the only place the token's <c>jobTitle</c> claim is read. These pin how
/// it reaches the activity record: present → trimmed value; absent or blank → null, because IT's
/// guidance is "treat a missing title as no title, not an error"; over-length → clamped to the
/// column so one odd directory value cannot fail a whole batch insert.
/// </summary>
public class UsageTrackingMiddlewareTests
{
    private static async Task<UserActivityRecord?> RunAsync(params Claim[] claims)
    {
        var channel = Channel.CreateBounded<UserActivityRecord>(10);
        var middleware = new UsageTrackingMiddleware(_ => Task.CompletedTask, channel);
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/customers";
        context.Request.Method = "GET";
        context.User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));

        await middleware.InvokeAsync(context);

        return channel.Reader.TryRead(out var record) ? record : null;
    }

    private static Claim SignedInAs(string upn) => new("preferred_username", upn);

    [Fact]
    public async Task RecordsTheJobTitleClaim_Trimmed_UnderTheShortName()
    {
        var record = await RunAsync(SignedInAs("CEgr@scoular.com"), new Claim(UsageTrackingMiddleware.JobTitleClaim, "  Senior Merchant "));

        Assert.NotNull(record);
        Assert.Equal("CEgr", record.UserId);
        Assert.Equal("Senior Merchant", record.JobTitle);
    }

    [Fact]
    public async Task MissingClaim_IsNoTitle_NotAnError()
    {
        var record = await RunAsync(SignedInAs("CEgr@scoular.com"));

        Assert.NotNull(record);
        Assert.Null(record.JobTitle);
    }

    [Fact]
    public async Task BlankClaim_IsNoTitle()
    {
        var record = await RunAsync(SignedInAs("CEgr@scoular.com"), new Claim(UsageTrackingMiddleware.JobTitleClaim, "   "));

        Assert.NotNull(record);
        Assert.Null(record.JobTitle);
    }

    [Fact]
    public async Task OverlongClaim_IsClampedToTheColumn()
    {
        var record = await RunAsync(SignedInAs("CEgr@scoular.com"), new Claim(UsageTrackingMiddleware.JobTitleClaim, new string('x', 300)));

        Assert.NotNull(record);
        Assert.Equal(256, record.JobTitle!.Length);
    }

    [Fact]
    public async Task UnauthenticatedRequest_RecordsNothing()
    {
        var record = await RunAsync();

        Assert.Null(record);
    }
}
