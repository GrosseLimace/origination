using System.Text.Json;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the note domain.</summary>
public static class NoteMappings
{
    // Case-insensitive so both the current lowercase Mentions JSON and any legacy PascalCase rows
    // (written before the lowercase [JsonPropertyName] contract) deserialize cleanly.
    private static readonly JsonSerializerOptions MentionsJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    /// <summary>Deserializes the Notes.Mentions JSON column, degrading to an empty list on empty
    /// or malformed content so a single bad/legacy row never fails the whole notes request.</summary>
    private static List<NoteMention> DeserializeMentions(string? json)
    {
        if (string.IsNullOrEmpty(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<NoteMention>>(json, MentionsJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static NoteResponse ToResponse(this Note n, IReadOnlyDictionary<string, string> nameMap) => new()
    {
        Id = n.Id,
        CustomerId = n.CustomerId,
        CustomerName = n.CustomerName,
        CustomerCode = n.CustomerCode,
        TradeUnit = n.TradeUnit,
        Description = n.Description,
        CreatedBy = DisplayNames.Apply(n.CreatedBy, nameMap),
        CreatedAt = n.CreatedAt,
        ModifiedBy = string.IsNullOrEmpty(n.ModifiedBy) ? n.ModifiedBy : DisplayNames.Apply(n.ModifiedBy, nameMap),
        ModifiedAt = n.ModifiedAt,
        IsPinned = n.IsPinned,
        IsDeleted = n.IsDeleted,
        DeletedAt = n.DeletedAt,
        DeletedBy = n.DeletedBy,
        Content = n.Content,
        Subject = n.Subject,
        // The raw JSON column is deserialized here (Api layer) so the Infrastructure entity stays
        // free of Api-layer types. Empty/invalid JSON degrades to an empty list (see DeserializeMentions).
        Mentions = DeserializeMentions(n.MentionsJson),
    };

    public static NoteLastContactResponse ToResponse(this NoteLastContact n) => new()
    {
        CustomerId = n.CustomerId,
        CustomerCode = n.CustomerCode,
        LastNoteAt = n.LastNoteAt,
    };
}
