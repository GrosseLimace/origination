using GrainOriginatorPortal.Api.Services;
using Xunit;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Verifies <see cref="TelemetrySanitizer.Redact"/> strips contact PII from telemetry TargetIds
/// before they reach long-lived storage and the admin usage dashboard (M-028). Emails and
/// formatted phone numbers are always redacted; bare digit runs only for free-text event types,
/// so numeric IDs on other events survive intact.
/// </summary>
public class TelemetrySanitizerTests
{
    private const string FreeText = "query-request-submitted";

    [Fact]
    public void RedactsEmailInFreeText()
    {
        var result = TelemetrySanitizer.Redact("producers near john.doe@example.com today", FreeText);
        Assert.DoesNotContain("john.doe@example.com", result);
        Assert.Contains("[redacted-email]", result);
    }

    [Theory]
    [InlineData("call (402) 555-1234")]
    [InlineData("call 402-555-1234")]
    [InlineData("call 402.555.1234")]
    public void RedactsFormattedPhone(string input)
    {
        var result = TelemetrySanitizer.Redact(input, FreeText);
        Assert.Contains("[redacted-phone]", result);
        Assert.DoesNotContain("555", result);
    }

    [Fact]
    public void RedactsBareLongDigitRunInFreeText()
    {
        var result = TelemetrySanitizer.Redact("acct 4025551234 wheat", FreeText);
        Assert.Contains("[redacted-number]", result);
        Assert.DoesNotContain("4025551234", result);
    }

    [Fact]
    public void KeepsSearchWordsIntact()
    {
        // Only the sensitive tokens are replaced — the rest stays so query-gap triage still works.
        var result = TelemetrySanitizer.Redact("wheat producers with grain on farm", FreeText);
        Assert.Equal("wheat producers with grain on farm", result);
    }

    [Fact]
    public void EmailAndFormattedPhoneRedactedEvenForNonFreeTextEvents()
    {
        // Defense-in-depth: emails / formatted phones are stripped regardless of event type.
        var result = TelemetrySanitizer.Redact("a@b.com (402) 555-1234", subFeatureCode: "some-other-event");
        Assert.Contains("[redacted-email]", result);
        Assert.Contains("[redacted-phone]", result);
    }

    [Fact]
    public void DoesNotClobberNumericIdOnNonFreeTextEvents()
    {
        // A large customer/contract id must survive — bare-digit masking is scoped to free-text.
        var result = TelemetrySanitizer.Redact("1234567", subFeatureCode: "profile-opened");
        Assert.Equal("1234567", result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void PassesThroughNullOrEmpty(string? input)
    {
        Assert.Equal(input, TelemetrySanitizer.Redact(input, FreeText));
    }

    [Fact]
    public void LibrarySearchIsTreatedAsFreeText()
    {
        // M-029: the QueryLibrary search-log path persists raw search-box text, so "library-search"
        // must mask bare digit runs (in addition to emails/phones) before it reaches the admin dashboard.
        var result = TelemetrySanitizer.Redact("wheat john@x.com acct 4025551234", subFeatureCode: "library-search");
        Assert.Contains("[redacted-email]", result);
        Assert.Contains("[redacted-number]", result);
        Assert.DoesNotContain("4025551234", result);
        Assert.Contains("wheat", result);
    }

    [Fact]
    public void RedactedTargetIdIsClampedToTheColumnLength()
    {
        // Redaction lengthens text ("4025551234" -> "[redacted-number]"). A 200-character question full
        // of numbers would exceed UserClickEvent.TargetId (nvarchar(200)) and fail the whole batch.
        var question = string.Concat(Enumerable.Repeat("4025551234 ", 18));
        var redacted = TelemetrySanitizer.Redact(question, "help-no-match");

        Assert.True(redacted!.Length > 200);
        Assert.Equal(200, GrainOriginatorPortal.Api.Controllers.UsageDashboardController.ClampTargetId(redacted)!.Length);
        Assert.Equal("short", GrainOriginatorPortal.Api.Controllers.UsageDashboardController.ClampTargetId("short"));
        Assert.Null(GrainOriginatorPortal.Api.Controllers.UsageDashboardController.ClampTargetId(null));
    }

    [Fact]
    public void UnansweredHelpQuestionIsTreatedAsFreeText()
    {
        // The Help panel records questions it couldn't answer so the FAQ can be extended. Users type
        // things like "can't find john smith 4025551234", so the whole free-text treatment applies.
        var result = TelemetrySanitizer.Redact("cant find john@x.com 4025551234", subFeatureCode: "help-no-match");
        Assert.Contains("[redacted-email]", result);
        Assert.Contains("[redacted-number]", result);
        Assert.DoesNotContain("4025551234", result);
        Assert.Contains("cant find", result);
    }
}
