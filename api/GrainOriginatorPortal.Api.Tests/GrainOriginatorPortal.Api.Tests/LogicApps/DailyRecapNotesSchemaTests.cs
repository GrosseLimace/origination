// Microsoft namespaces
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Tests.LogicApps;

/// <summary>
/// PROD alert 2026-10-21: the daily-recap run failed at <c>Parse_JSON</c> (ValidationFailed) because one
/// note returned by <c>dbo.GetRecapNotes</c> had <c>TradeUnit = null</c>. That is legitimate data --
/// <c>NoteService.CreateAsync</c> stamps the customer's first ACTIVE trade unit, and a producer with none
/// gets a null -- but the schema demanded a string, so the whole group's recap was dropped.
/// <para>
/// Every column the proc returns from a nullable database column must accept null in the schema.
/// </para>
/// </summary>
public class DailyRecapNotesSchemaTests
{
    private static readonly Lazy<JsonElement> NoteRowProperties = new(LoadNoteRowProperties);

    [Theory]
    [InlineData("TradeUnit")]   // dbo.Notes.TradeUnit is NULL when the customer had no active trade unit
    [InlineData("ScoularId")]   // dbo.Customer.ScoularId is a nullable column
    public void NullableColumn_AcceptsNull(string column)
    {
        var type = NoteRowProperties.Value.GetProperty(column).GetProperty("type");

        Assert.Equal(JsonValueKind.Array, type.ValueKind);
        var types = type.EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("string", types);
        Assert.Contains("null", types);
    }

    // -------------------------------------------------------------------------

    private static JsonElement LoadNoteRowProperties()
    {
        // Walk up from the test output folder to the repository root (the folder holding the .sln).
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "GrainOriginatorPortal.sln")))
            dir = dir.Parent;
        if (dir is null) throw new InvalidOperationException("Could not locate the repository root.");

        var path = Path.Combine(dir.FullName, "infra", "logic-apps", "notes-daily-recap", "azuredeploy.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));

        var workflow = doc.RootElement.GetProperty("resources").EnumerateArray()
            .First(r => r.GetProperty("type").GetString() == "Microsoft.Logic/workflows");
        var parseJson = FindAction(workflow.GetProperty("properties").GetProperty("definition").GetProperty("actions"), "Parse_JSON")
            ?? throw new InvalidOperationException("Parse_JSON action not found in the daily-recap template.");

        return parseJson.GetProperty("inputs").GetProperty("schema")
            .GetProperty("properties").GetProperty("ResultSets")
            .GetProperty("properties").GetProperty("Table1")
            .GetProperty("items").GetProperty("properties")
            .Clone();
    }

    private static JsonElement? FindAction(JsonElement actions, string name)
    {
        foreach (var action in actions.EnumerateObject())
        {
            if (action.Name == name) return action.Value;

            // Nested scopes: Foreach/Scope "actions", If "else.actions", Switch "cases.*.actions" / "default.actions".
            var children = new List<JsonElement>();
            if (action.Value.TryGetProperty("actions", out var a)) children.Add(a);
            if (action.Value.TryGetProperty("else", out var e) && e.TryGetProperty("actions", out var ea)) children.Add(ea);
            if (action.Value.TryGetProperty("default", out var d) && d.TryGetProperty("actions", out var da)) children.Add(da);
            if (action.Value.TryGetProperty("cases", out var cases))
                foreach (var c in cases.EnumerateObject())
                    if (c.Value.TryGetProperty("actions", out var ca)) children.Add(ca);

            foreach (var child in children)
                if (FindAction(child, name) is { } found) return found;
        }

        return null;
    }
}
