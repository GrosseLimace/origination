// Microsoft namespaces
using Microsoft.Extensions.Http.Resilience;

// Third-party namespaces
using Polly;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.Engagement.Services;
using GrainOriginatorPortal.Infrastructure.Modules.Engagement;
using GrainOriginatorPortal.Api.Platform.Middleware;

namespace GrainOriginatorPortal.Api.Modules.Engagement;

/// <summary>
/// The Engagement module: notes with their mentions, reminders and their Outlook events, daily recap groups and
/// Teams channels. Its controllers are found by MVC; this registers what they depend on. It reads customers
/// through the Customers module's <c>ICustomerLookup</c>, and Microsoft Graph through the shared "graph" client
/// that Platform registers (AddDirectory).
/// </summary>
public static class EngagementModule
{
    public static IServiceCollection AddEngagementModule(this IServiceCollection services)
    {
        services.AddEngagementInfrastructure();

        services.AddScoped<INoteService, NoteService>();
        services.AddScoped<IReminderService, ReminderService>();
        services.AddScoped<IOutlookCalendarService, OutlookCalendarService>();
        services.AddScoped<IDailyRecapGroupService, DailyRecapGroupService>();
        services.AddScoped<ITeamsChannelService, TeamsChannelService>();
        services.AddScoped<ITeamsDirectoryService, TeamsDirectoryService>();

        AddNoRetryGraphClient(services);
        return services;
    }

    // A second Graph client for the ONE call that must never be re-sent: creating an Outlook calendar
    // event. POST /me/events is non-idempotent and has no idempotency key, so when Graph accepts the
    // event but the response is lost — a client timeout, a reset, a gateway 504 raised after the event
    // was already written — a retry produces a SECOND event on the user's calendar. The shared "graph"
    // client Platform registers retries on exactly those failures (HttpRequestException / TaskCanceledException,
    // which is what its 10s timeout surfaces as), so a single create could land three events.
    //
    // This is the same hazard the Instant Share Note workflow hit with Graph sendMail, where the default
    // policy mailed up to five copies of one note; that was fixed with retryPolicy: none. Reads and the
    // idempotent calendar calls (PATCH the window, DELETE the event) keep using "graph" and its retry.
    //
    // The circuit breaker is kept: it fails fast, it does not re-send.
    private static void AddNoRetryGraphClient(IServiceCollection services)
    {
        services.AddHttpClient(OutlookCalendarService.NoRetryClient, client =>
        {
            client.BaseAddress = new Uri("https://graph.microsoft.com/v1.0/");
            client.Timeout = TimeSpan.FromSeconds(10);
        })
        .AddHttpMessageHandler<CorrelationIdOutboundHandler>()
        .AddResilienceHandler(OutlookCalendarService.NoRetryClient, pipeline =>
        {
            pipeline.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
            {
                FailureRatio = 0.5,
                SamplingDuration = TimeSpan.FromSeconds(30),
                MinimumThroughput = 5,
                BreakDuration = TimeSpan.FromSeconds(30)
            });
        });
    }
}
