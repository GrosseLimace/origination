using System.Collections.Generic;
using System.Text.Json;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using Xunit;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Locks the JSON contract for the dbo.Notes.Mentions column. NoteService serializes mentions with a
/// plain JsonSerializer.Serialize (default options → PascalCase unless overridden), while the Instant
/// Share Note Logic App reads the keys case-sensitively as lowercase (item()?['type'/'id'/'email']).
/// If these keys ever regress to PascalCase the Logic App silently resolves no recipients and sends
/// nothing — no error — so guard the exact wire shape here.
/// </summary>
public class NoteMentionSerializationTests
{
    private static readonly NoteMention Sample = new()
    {
        Type = "person",
        Id = "CEgr",
        Name = "Caden Egr",
        Email = "CEgr@scoular.com"
    };

    [Fact]
    public void SerializesWithLowercaseKeys_MatchingLogicAppContract()
    {
        // Mirrors NoteService.SerializeMentions — default serializer, no options.
        var json = JsonSerializer.Serialize(new[] { Sample });

        Assert.Contains("\"type\":\"person\"", json);
        Assert.Contains("\"id\":\"CEgr\"", json);
        Assert.Contains("\"name\":\"Caden Egr\"", json);
        Assert.Contains("\"email\":\"CEgr@scoular.com\"", json);
        // Must NOT emit PascalCase keys the Logic App cannot read.
        Assert.DoesNotContain("\"Type\"", json);
        Assert.DoesNotContain("\"Id\"", json);
    }

    [Fact]
    public void RoundTripsThroughDefaultSerializer()
    {
        // NoteMappings deserializes the stored column with a default JsonSerializer.Deserialize.
        var json = JsonSerializer.Serialize(new[] { Sample });
        var back = JsonSerializer.Deserialize<List<NoteMention>>(json);

        Assert.NotNull(back);
        var m = Assert.Single(back!);
        Assert.Equal("person", m.Type);
        Assert.Equal("CEgr", m.Id);
        Assert.Equal("Caden Egr", m.Name);
        Assert.Equal("CEgr@scoular.com", m.Email);
    }

    // ── ToResponse mention deserialization (NoteMappings) ─────────────────────────────────────
    // Guards the GET /api/notes 500 that occurred when a stored Mentions blob didn't match the
    // (now lowercase, required) NoteMention contract. The mapping must be tolerant.

    private static Note NoteWith(string? mentionsJson) => new()
    {
        Id = 1,
        CustomerId = 100,
        CustomerName = "Acme Farms",
        CreatedBy = "CEgr",
        Description = "note body",
        MentionsJson = mentionsJson
    };

    [Fact]
    public void ToResponse_ParsesCurrentLowercaseMentions()
    {
        var resp = NoteWith("[{\"type\":\"trade-unit\",\"id\":\"OMAHA\",\"name\":\"Omaha TU\"}]")
            .ToResponse(new Dictionary<string, string>());
        var m = Assert.Single(resp.Mentions);
        Assert.Equal("trade-unit", m.Type);
        Assert.Equal("OMAHA", m.Id);
    }

    [Fact]
    public void ToResponse_ParsesLegacyPascalCaseMentions()
    {
        // Pre-lowercase-contract rows still deserialize (case-insensitive) rather than 500.
        var resp = NoteWith("[{\"Type\":\"person\",\"Id\":\"CEgr\",\"Name\":\"Caden Egr\",\"Email\":\"CEgr@scoular.com\"}]")
            .ToResponse(new Dictionary<string, string>());
        var m = Assert.Single(resp.Mentions);
        Assert.Equal("person", m.Type);
        Assert.Equal("CEgr", m.Id);
        Assert.Equal("Caden Egr", m.Name);
    }

    [Fact]
    public void ToResponse_BlobMissingRequiredFieldsDegradesToEmpty()
    {
        // The exact shape that 500'd the notes list: a stored blob that doesn't satisfy the
        // required NoteMention fields must degrade to an empty list, not throw.
        var resp = NoteWith("[{\"foo\":\"bar\"}]").ToResponse(new Dictionary<string, string>());
        Assert.Empty(resp.Mentions);
    }

    [Fact]
    public void ToResponse_MalformedJsonDegradesToEmpty()
    {
        var resp = NoteWith("{ not valid json").ToResponse(new Dictionary<string, string>());
        Assert.Empty(resp.Mentions);
    }

    [Fact]
    public void ToResponse_NullMentionsIsEmpty()
    {
        var resp = NoteWith(null).ToResponse(new Dictionary<string, string>());
        Assert.Empty(resp.Mentions);
    }
}
