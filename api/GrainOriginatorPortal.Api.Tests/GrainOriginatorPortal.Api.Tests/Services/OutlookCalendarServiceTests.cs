// System namespaces
using System.Net;
using System.Text;
using System.Text.Json;

// Microsoft namespaces
using Microsoft.Extensions.Logging;
using Microsoft.Identity.Web;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The calendar write moved out of the browser and into the API on 2026-09-15, so the behaviours the
/// client version got right now have to be guarded here. Two themes run through all of it: the event
/// is written to the CALLER's own calendar and nobody else's, and nothing ever throws, because a
/// calendar failure must not disturb a reminder that is already saved.
/// </summary>
public class OutlookCalendarServiceTests
{
    private readonly StubHandler _handler = new();
    private readonly Mock<ITokenAcquisition> _tokens = new();

    private static readonly DateTime DueUtc = new(2026, 3, 10, 15, 30, 0, DateTimeKind.Utc);

    /// <summary>Every named client the service asked for, in order. Which one it picks is the whole
    /// safety story for creating an event, so the tests assert on it.</summary>
    private readonly List<string> _clientsRequested = [];

    private OutlookCalendarService Build()
    {
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(It.IsAny<string>()))
            .Returns((string name) =>
            {
                _clientsRequested.Add(name);
                return new HttpClient(_handler) { BaseAddress = new Uri("https://graph.microsoft.com/v1.0/") };
            });

        return new OutlookCalendarService(_tokens.Object, factory.Object,
            new Mock<ILogger<OutlookCalendarService>>().Object);
    }

    private void ArrangeToken() =>
        _tokens.Setup(t => t.GetAccessTokenForUserAsync(
                It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()))
            .ReturnsAsync("graph-token");

    private static OutlookEventRequest Request(string? notes = null, string subject = "Follow up") => new()
    {
        Subject = subject,
        CustomerName = "Smith Farms",
        Notes = notes,
        DueAtUtc = DueUtc,
        TimeZone = "America/Chicago",
        ProducerLink = "https://origination/?customerId=10",
    };

    // ── Create ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WritesToTheCallersOwnCalendar_NeverAnotherMailbox()
    {
        // /me/events is the whole reason a delegated scope is enough. /users/{id}/events would be a
        // different, far broader capability.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Created, """{"id":"AAMkAD=="}""");

        await Build().CreateEventAsync(Request(), CancellationToken.None);

        Assert.Contains(_handler.RequestUris, u => u.EndsWith("/me/events"));
        Assert.DoesNotContain(_handler.RequestUris, u => u.Contains("/users/"));
    }

    [Fact]
    public async Task SendsAnUnzonedLocalLiteralPlusATimeZone_NotAnOffsetString()
    {
        // Handing Graph an ISO string with an offset makes it interpret the zone differently from
        // what the user picked, so the event lands at the wrong hour.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Created, """{"id":"AAMkAD=="}""");

        await Build().CreateEventAsync(Request(), CancellationToken.None);

        // Assert on the DECODED json: System.Text.Json escapes HTML-sensitive characters, so raw
        // substring matching on the wire format is misleading.
        var start = _handler.Json!.RootElement.GetProperty("start");
        Assert.Equal("America/Chicago", start.GetProperty("timeZone").GetString());
        // 15:30 UTC is 10:30 CDT. March 10 2026 is after the second Sunday in March, so Central is
        // on daylight time — the conversion has to honour that, not assume a fixed -6.
        Assert.Equal("2026-03-10T10:30:00", start.GetProperty("dateTime").GetString());
        Assert.DoesNotContain("+00:00", start.GetProperty("dateTime").GetString());
    }

    [Fact]
    public async Task BooksAThirtyMinuteBlockWithAFifteenMinuteReminder()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Created, """{"id":"AAMkAD=="}""");

        await Build().CreateEventAsync(Request(), CancellationToken.None);

        var root = _handler.Json!.RootElement;
        Assert.Equal("2026-03-10T10:30:00", root.GetProperty("start").GetProperty("dateTime").GetString());
        Assert.Equal("2026-03-10T11:00:00", root.GetProperty("end").GetProperty("dateTime").GetString());
        Assert.Equal(15, root.GetProperty("reminderMinutesBeforeStart").GetInt32());
        Assert.True(root.GetProperty("isReminderOn").GetBoolean());
    }

    [Fact]
    public async Task LinksBackToTheProducerAndEscapesUserText()
    {
        // Subject and notes are user-authored free text landing in an HTML body.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Created, """{"id":"AAMkAD=="}""");

        await Build().CreateEventAsync(Request(notes: "<script>alert(1)</script> R&D"), CancellationToken.None);

        var html = _handler.Json!.RootElement.GetProperty("body").GetProperty("content").GetString()!;
        Assert.Contains("customerId=10", html);
        Assert.DoesNotContain("<script>", html);       // the tag itself never survives
        Assert.Contains("&lt;script&gt;", html);
        Assert.Contains("R&amp;D", html);              // & escaped once...
        Assert.DoesNotContain("&amp;amp;", html);      // ...and not double-encoded
    }

    [Fact]
    public async Task ReturnsTheGraphEventId()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Created, """{"id":"AAMkAD=="}""");

        Assert.Equal("AAMkAD==", await Build().CreateEventAsync(Request(), CancellationToken.None));
    }

    [Fact]
    public async Task ReturnsNullRatherThanThrowing_WhenGraphRejectsTheWrite()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Forbidden, "{}");

        Assert.Null(await Build().CreateEventAsync(Request(), CancellationToken.None));
    }

    [Fact]
    public async Task ReturnsNull_WhenConsentHasNotBeenGranted()
    {
        // The expected state in every environment until IT grants consent.
        _tokens.Setup(t => t.GetAccessTokenForUserAsync(
                It.IsAny<IEnumerable<string>>(), It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<System.Security.Claims.ClaimsPrincipal?>(), It.IsAny<TokenAcquisitionOptions?>()))
            .ThrowsAsync(new MicrosoftIdentityWebChallengeUserException(
                new Microsoft.Identity.Client.MsalUiRequiredException("consent_required", "consent required"),
                ["Calendars.ReadWrite"]));

        Assert.Null(await Build().CreateEventAsync(Request(), CancellationToken.None));
        Assert.Empty(_handler.RequestUris);   // and it never even tried to call Graph
    }

    [Fact]
    public async Task FallsBackToUtc_WhenTheTimeZoneIsNotRecognised()
    {
        // A reminder an hour out beats no reminder at all.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Created, """{"id":"AAMkAD=="}""");

        await Build().CreateEventAsync(Request() with { TimeZone = "Not/AZone" }, CancellationToken.None);

        Assert.Equal("UTC", _handler.Json!.RootElement.GetProperty("start").GetProperty("timeZone").GetString());
    }

    // ── Reschedule ────────────────────────────────────────────────────────────

    [Fact]
    public async Task PatchesOnlyStartAndEnd_SoOutlookMovesTheEventRatherThanCancellingIt()
    {
        // Replacing the event, or deleting and recreating it, renders the original slot as
        // "Canceled". Subject and body are left alone so a user's own edits in Outlook survive.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.OK, "{}");

        Assert.True(await Build().UpdateEventWindowAsync("AAMkAD==", DueUtc, "America/Chicago", CancellationToken.None));

        Assert.Equal(HttpMethod.Patch, _handler.LastMethod);
        var patched = _handler.Json!.RootElement;
        Assert.True(patched.TryGetProperty("start", out _));
        Assert.True(patched.TryGetProperty("end", out _));
        Assert.False(patched.TryGetProperty("subject", out _));
        Assert.False(patched.TryGetProperty("body", out _));
    }

    [Fact]
    public async Task ReportsFalseRatherThanThrowing_WhenTheMoveFails()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.InternalServerError, "{}");

        Assert.False(await Build().UpdateEventWindowAsync("AAMkAD==", DueUtc, "UTC", CancellationToken.None));
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DeletesFromTheCallersOwnCalendar()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.NoContent, "");

        Assert.True(await Build().DeleteEventAsync("AAMkAD==", CancellationToken.None));

        Assert.Equal(HttpMethod.Delete, _handler.LastMethod);
        Assert.Contains(_handler.RequestUris, u => u.Contains("/me/events/"));
    }

    [Fact]
    public async Task TreatsAnAlreadyMissingEventAsSuccess()
    {
        // The end state is the one we wanted, so this is not a failure.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.NotFound, "{}");

        Assert.True(await Build().DeleteEventAsync("AAMkAD==", CancellationToken.None));
    }

    [Fact]
    public async Task ReportsFalseWhenTheDeleteGenuinelyFails()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.InternalServerError, "{}");

        Assert.False(await Build().DeleteEventAsync("AAMkAD==", CancellationToken.None));
    }

    // ── Which HTTP client each call uses ──────────────────────────────────────
    // POST /me/events is non-idempotent and has no idempotency key. If Graph writes the event and
    // the response is lost, a retry puts a SECOND event on someone's calendar. The shared "graph"
    // client retries on exactly that failure, so creating must use the non-retrying one. The other
    // two calls are idempotent and keep the retry. This is the same hazard the Instant Share Note
    // workflow hit with sendMail, where the default policy mailed up to five copies of one note.

    [Fact]
    public async Task CreatingAnEvent_UsesTheClientThatWillNotRetry()
    {
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.Created, """{"id":"AAMkAD=="}""");

        await Build().CreateEventAsync(Request(), CancellationToken.None);

        Assert.Equal(["graph-no-retry"], _clientsRequested);
    }

    [Fact]
    public async Task MovingAnEvent_KeepsTheRetryingClient()
    {
        // Idempotent: patching the same window twice is the same result.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.OK, "{}");

        await Build().UpdateEventWindowAsync("AAMkAD==", DueUtc, "UTC", CancellationToken.None);

        Assert.Equal(["graph"], _clientsRequested);
    }

    [Fact]
    public async Task DeletingAnEvent_KeepsTheRetryingClient()
    {
        // Idempotent: the end state is the same, and an already-missing event counts as success.
        ArrangeToken();
        _handler.Enqueue(HttpStatusCode.NoContent, "");

        await Build().DeleteEventAsync("AAMkAD==", CancellationToken.None);

        Assert.Equal(["graph"], _clientsRequested);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses = new();

        public List<string> RequestUris { get; } = [];
        public string? LastBody { get; private set; }

        /// <summary>The last request body, parsed. Assert against this rather than the raw string:
        /// System.Text.Json escapes HTML-sensitive characters, so the wire format is not what the
        /// receiver sees.</summary>
        public JsonDocument? Json => LastBody is null ? null : JsonDocument.Parse(LastBody);
        public HttpMethod? LastMethod { get; private set; }

        public void Enqueue(HttpStatusCode status, string json) =>
            _responses.Enqueue(new HttpResponseMessage(status)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUris.Add(request.RequestUri!.ToString());
            LastMethod = request.Method;
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);

            return _responses.Count == 0
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}", Encoding.UTF8, "application/json") }
                : _responses.Dequeue();
        }
    }
}
