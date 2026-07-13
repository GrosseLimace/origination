using System.Collections.Generic;
using System.Text.Json;
using GrainOriginatorPortal.Api.Models;
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
}
