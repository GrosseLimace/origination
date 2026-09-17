using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

using Microsoft.Identity.Web;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Writes follow-up reminders to the calling user's own Outlook calendar using Microsoft Graph
/// <b>on-behalf-of</b> that user.
/// <para>
/// This used to run in the browser with a delegated token the SPA acquired itself. IT Security moved
/// it here on 2026-09-15: delegated Graph permissions belong on the API registration, because their
/// app registrations are rebuilt from a config template and a permission added by hand to a SPA
/// would vanish on the next reconcile. The boundary is unchanged — the exchange preserves the user's
/// identity, so this still writes only to the caller's own calendar, never anyone else's. The
/// endpoint is <c>/me/events</c> for exactly that reason; it must never become
/// <c>/users/{id}/events</c>.
/// </para>
/// <para>
/// A pleasant side effect of moving: the browser no longer needs a consent popup on first use, which
/// previously risked interrupting a half-filled reminder form.
/// </para>
/// </summary>
public class OutlookCalendarService : IOutlookCalendarService
{
    /// <summary>Delegated permission, held on the API app registration.</summary>
    private static readonly string[] GraphScopes = ["Calendars.ReadWrite"];

    /// <summary>How long the calendar block runs. A follow-up is a prompt to make a call, not a meeting.</summary>
    private const int EventMinutes = 30;

    /// <summary>Outlook pops its reminder this many minutes before the block.</summary>
    private const int ReminderMinutesBeforeStart = 15;

    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<OutlookCalendarService> _logger;

    public OutlookCalendarService(
        ITokenAcquisition tokenAcquisition,
        IHttpClientFactory httpClientFactory,
        ILogger<OutlookCalendarService> logger)
    {
        _tokenAcquisition = tokenAcquisition;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<string?> CreateEventAsync(OutlookEventRequest request, CancellationToken cancellationToken)
    {
        // Deliberately the non-retrying client: see NoRetryClient.
        var http = await CreateGraphClientAsync(NoRetryClient);
        if (http is null) return null;

        var start = request.DueAtUtc;
        var body = new
        {
            subject = request.Subject,
            body = new { contentType = "HTML", content = BuildBody(request) },
            start = ToGraphTime(start, request.TimeZone),
            end = ToGraphTime(start.AddMinutes(EventMinutes), request.TimeZone),
            isReminderOn = true,
            reminderMinutesBeforeStart = ReminderMinutesBeforeStart,
        };

        try
        {
            using var response = await http.PostAsJsonAsync("me/events", body, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                LogGraphFailure(response.StatusCode, "create a calendar event");
                return null;
            }

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            return doc.RootElement.TryGetProperty("id", out var id) ? id.GetString() : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not create the Outlook event; the reminder itself is unaffected");
            return null;
        }
    }

    /// <inheritdoc />
    public async Task<bool> UpdateEventWindowAsync(
        string eventId, DateTime dueAtUtc, string timeZone, CancellationToken cancellationToken)
    {
        var http = await CreateGraphClientAsync();
        if (http is null) return false;

        // PATCH ONLY start and end. Replacing the event, or deleting and recreating it, makes Outlook
        // render the original slot as "Canceled". Subject, body and reminder settings are left alone
        // so a user's own tweaks in Outlook survive a reschedule.
        var patch = new
        {
            start = ToGraphTime(dueAtUtc, timeZone),
            end = ToGraphTime(dueAtUtc.AddMinutes(EventMinutes), timeZone),
        };

        try
        {
            using var content = JsonContent.Create(patch);
            using var response = await http.PatchAsync($"me/events/{Uri.EscapeDataString(eventId)}", content, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                LogGraphFailure(response.StatusCode, "move a calendar event");
                return false;
            }
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not move the Outlook event; the reminder itself is unaffected");
            return false;
        }
    }

    /// <inheritdoc />
    public async Task<bool> DeleteEventAsync(string eventId, CancellationToken cancellationToken)
    {
        var http = await CreateGraphClientAsync();
        if (http is null) return false;

        try
        {
            using var response = await http.DeleteAsync($"me/events/{Uri.EscapeDataString(eventId)}", cancellationToken);

            // Already gone is the end state we wanted, so it is a success rather than a failure.
            if (response.StatusCode == HttpStatusCode.NotFound) return true;

            if (!response.IsSuccessStatusCode)
            {
                LogGraphFailure(response.StatusCode, "delete a calendar event");
                return false;
            }
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not delete the Outlook event; the reminder itself is unaffected");
            return false;
        }
    }

    /// <summary>A Graph client carrying an on-behalf-of token, or null when one cannot be obtained.
    /// Null is an ordinary outcome, not an error: it is what every environment looks like until
    /// admin consent is granted.</summary>
    /// <summary>The retrying Graph client, for the calendar calls that are safe to repeat.</summary>
    private const string RetryingClient = "graph";

    /// <summary>The non-retrying Graph client, for creating an event. A repeated POST /me/events
    /// writes a SECOND event on the user's calendar, so an ambiguous timeout must not be retried.</summary>
    private const string NoRetryClient = "graph-no-retry";

    private async Task<HttpClient?> CreateGraphClientAsync(string clientName = RetryingClient)
    {
        string token;
        try
        {
            token = await _tokenAcquisition.GetAccessTokenForUserAsync(GraphScopes);
        }
        catch (MicrosoftIdentityWebChallengeUserException ex)
        {
            _logger.LogInformation(ex,
                "Outlook calendar unavailable: Graph consent not granted for {Scopes}", string.Join(", ", GraphScopes));
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Outlook calendar unavailable: could not acquire a Graph token on-behalf-of the caller");
            return null;
        }

        var http = _httpClientFactory.CreateClient(clientName);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return http;
    }

    private void LogGraphFailure(HttpStatusCode status, string action)
    {
        // A 403 means the app registration is missing the permission, which is the most likely
        // misconfiguration by far. Name it rather than log a bare status code.
        if (status == HttpStatusCode.Forbidden)
        {
            _logger.LogWarning(
                "Graph returned 403 trying to {Action}. The API app registration needs delegated {Scopes} with admin consent.",
                action, string.Join(", ", GraphScopes));
        }
        else
        {
            _logger.LogWarning("Graph returned {Status} trying to {Action}", (int)status, action);
        }
    }

    /// <summary>
    /// Graph wants an UNZONED local literal plus a separate time-zone name. Handing it an ISO string
    /// with an offset makes it interpret the zone differently from what the user picked, so the event
    /// lands at the wrong hour.
    /// <para>The zone comes from the BROWSER, because the event is written for the person sitting in
    /// front of it, not for wherever the server happens to run. An unrecognised zone falls back to
    /// UTC rather than throwing — a reminder an hour out beats no reminder.</para>
    /// </summary>
    private static GraphDateTime ToGraphTime(DateTime utc, string timeZone)
    {
        DateTime local;
        string zone;
        try
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), tz);
            zone = timeZone;
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            local = utc;
            zone = "UTC";
        }

        return new GraphDateTime(local.ToString("yyyy-MM-ddTHH:mm:ss"), zone);
    }

    /// <summary>Graph's dateTimeTimeZone shape.
    /// <para>A named type rather than an anonymous one on purpose: when this was returned as
    /// <c>object</c>, the serializer wrote the anonymous value as <c>{}</c> and the event went to
    /// Graph with no start or end at all. A concrete type makes that impossible.</para></summary>
    private sealed record GraphDateTime(
        [property: JsonPropertyName("dateTime")] string DateTime,
        [property: JsonPropertyName("timeZone")] string TimeZone);

    /// <summary>Event body: the producer, the user's own note, and a link straight back to the page.</summary>
    private static string BuildBody(OutlookEventRequest request)
    {
        var parts = new List<string>
        {
            $"<p>Follow-up with <strong>{Escape(request.CustomerName)}</strong>.</p>",
        };

        if (!string.IsNullOrWhiteSpace(request.Notes))
        {
            parts.Add($"<p>{Escape(request.Notes).Replace("\n", "<br>")}</p>");
        }

        parts.Add($"<p><a href=\"{Escape(request.ProducerLink)}\">Open in Origination Workbench</a></p>");
        return string.Concat(parts);
    }

    /// <summary>The subject and notes are user-authored free text landing in an HTML body — escape
    /// them. `&amp;` first, or the entities the later replacements emit get double-encoded.</summary>
    private static string Escape(string value) =>
        value.Replace("&", "&amp;")
             .Replace("<", "&lt;")
             .Replace(">", "&gt;")
             .Replace("\"", "&quot;")
             .Replace("'", "&#39;");
}
