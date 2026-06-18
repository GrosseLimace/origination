using System.Text.Json;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the note domain.</summary>
public static class NoteMappings
{
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
        // free of Api-layer types. Empty/invalid JSON degrades to an empty list.
        Mentions = string.IsNullOrEmpty(n.MentionsJson)
            ? []
            : JsonSerializer.Deserialize<List<NoteMention>>(n.MentionsJson) ?? [],
    };
}
