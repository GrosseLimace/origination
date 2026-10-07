// Microsoft namespaces
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Tests.LogicApps;

/// <summary>
/// M-046 / M-047 (baseline scan 2026-10-05, CWE-79). A recap group's Name is free text a user sets
/// through POST/PUT /api/dailyrecapgroups. The daily-recap Logic App used to interpolate it raw into
/// the HTML email body, so a name such as
/// <c>&lt;a href="https://attacker.example/login"&gt;Session expired&lt;/a&gt;</c> reached every
/// member's inbox -- and every Teams channel the recap posts to -- as live markup, sent from the
/// app's trusted shared mailbox. Ready-made credential phishing, no script needed.
/// <para>
/// These tests read the deployed template itself, because the bug lives in the Logic App, not in
/// C#: there is no service method whose behaviour a unit test could pin instead.
/// </para>
/// </summary>
public class DailyRecapHtmlEncodingTests
{
    private const string RawGroupName = "@{variables('groupName')}";

    private static readonly Lazy<JsonElement> Definition = new(LoadDefinition);

    [Fact]
    public void EmailBody_NeverInterpolatesTheGroupNameRaw()
    {
        var body = EmailBodyValue();

        Assert.DoesNotContain(RawGroupName, body);
    }

    [Fact]
    public void EmailBody_EncodesTheGroupName_AmpersandFirst()
    {
        var body = EmailBodyValue();

        // & must be replaced FIRST (innermost), or the &lt; / &gt; it produces get double-encoded
        // into &amp;lt; and the name renders as visible entity text.
        const string encoded =
            "replace(replace(replace(coalesce(variables('groupName'), ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')";
        Assert.Contains(encoded, body);
    }

    [Fact]
    public void EveryHtmlSend_GoesThroughTheEncodedEmailBody()
    {
        // The encoding only protects recipients if nothing builds HTML by another route. Pin that all
        // four sends (two email, two Teams) deliver emailBody and nothing else, so a future send that
        // interpolates the name directly fails here rather than in someone's inbox.
        var htmlContents = new List<string>();
        Walk(Definition.Value, el =>
        {
            if (el.ValueKind == JsonValueKind.Object
                && el.TryGetProperty("contentType", out var ct) && ct.GetString() == "HTML"
                && el.TryGetProperty("content", out var content))
            {
                htmlContents.Add(content.GetString() ?? string.Empty);
            }
        });

        Assert.NotEmpty(htmlContents);
        Assert.All(htmlContents, c => Assert.Equal("@{variables('emailBody')}", c));
    }

    [Fact]
    public void SubjectsKeepTheRawName_BecauseASubjectIsPlainText()
    {
        // The opposite mistake: encoding the subject too would show "Corn &amp; Soy" to recipients.
        // Graph renders subjects as text, so they must stay raw.
        var subjects = new List<string>();
        Walk(Definition.Value, el =>
        {
            if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty("subject", out var s)
                && s.ValueKind == JsonValueKind.String)
            {
                subjects.Add(s.GetString()!);
            }
        });

        Assert.NotEmpty(subjects);
        Assert.All(subjects, s => Assert.Contains(RawGroupName, s));
    }

    // -------------------------------------------------------------------------

    private static string EmailBodyValue()
    {
        string? found = null;
        Walk(Definition.Value, el =>
        {
            if (el.ValueKind == JsonValueKind.Object
                && el.TryGetProperty("Set_emailBody", out var action)
                && action.ValueKind == JsonValueKind.Object   // skip runAfter references, which are arrays
                && action.TryGetProperty("inputs", out var inputs)
                && inputs.TryGetProperty("value", out var value))
            {
                found = value.GetString();
            }
        });

        return found ?? throw new InvalidOperationException("Set_emailBody action not found in the daily-recap template.");
    }

    private static void Walk(JsonElement el, Action<JsonElement> visit)
    {
        visit(el);
        switch (el.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var p in el.EnumerateObject()) Walk(p.Value, visit);
                break;
            case JsonValueKind.Array:
                foreach (var item in el.EnumerateArray()) Walk(item, visit);
                break;
        }
    }

    private static JsonElement LoadDefinition()
    {
        // Walk up from the test output folder to the repository root (the folder holding the .sln).
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "GrainOriginatorPortal.sln")))
            dir = dir.Parent;
        if (dir is null) throw new InvalidOperationException("Could not locate the repository root.");

        var path = Path.Combine(dir.FullName, "infra", "logic-apps", "notes-daily-recap", "azuredeploy.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.Clone();
    }
}
