using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;


namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Interfaces;

/// <summary>Everything one producer has in the field plan, across all years.</summary>
public sealed record FieldPlanRows(
    IReadOnlyList<ProducerField> Fields,
    IReadOnlyList<ProducerFieldSeason> Seasons,
    IReadOnlyList<FieldProgramRecord> Records);

/// <summary>
/// Data access for the field plan. Reads for a single row return it TRACKED (with its parents loaded) so
/// the service can change it and call <see cref="SaveChangesAsync"/>; the service owns every rule.
/// Removed seasons and records are hidden by the model's soft-delete filters.
/// </summary>
public interface IFieldPlanRepository
{
    /// <summary>The producer's fields, seasons and records, untracked.</summary>
    Task<FieldPlanRows> LoadAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>The field for a split ID, whichever producer holds it.</summary>
    Task<ProducerField?> GetFieldAsync(string splitId, CancellationToken cancellationToken);

    /// <summary>A season with its field.</summary>
    Task<ProducerFieldSeason?> GetSeasonAsync(int seasonId, CancellationToken cancellationToken);

    /// <summary>The field's live seasons in a crop year.</summary>
    Task<List<ProducerFieldSeason>> GetSeasonsForFieldAsync(int producerFieldId, int cropYear, CancellationToken cancellationToken);

    /// <summary>The field's records, any year, that hold a confirmed CI (Official), with their seasons.</summary>
    Task<List<FieldProgramRecord>> GetConfirmedRecordsForFieldAsync(int producerFieldId, CancellationToken cancellationToken);

    Task<List<FieldProgramRecord>> GetRecordsForSeasonAsync(int seasonId, CancellationToken cancellationToken);

    /// <summary>A record with its season and field.</summary>
    Task<FieldProgramRecord?> GetRecordAsync(int recordId, CancellationToken cancellationToken);

    Task<FieldProgramRecord?> GetRecordAsync(int seasonId, string programKey, CancellationToken cancellationToken);

    /// <summary>Whether the planting intention exists, belongs to the producer and is for that year.</summary>
    Task<bool> PlantingIntentionMatchesAsync(int plantingIntentionId, long customerId, int cropYear, CancellationToken cancellationToken);

    Task<bool> CustomerExistsAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>Whether the producer exists, and its CTRM code (Customer.ScoularId) when it has one.</summary>
    Task<(bool Exists, string? ScoularId)> GetCustomerCodeAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>The crop row's commodity code (PlantingIntention.Crop, e.g. "YC"), deleted rows included; null when it doesn't exist.</summary>
    Task<string?> GetPlantingIntentionCropAsync(int plantingIntentionId, CancellationToken cancellationToken);

    /// <summary>The producer's 45Z documents, for one crop year or all of them, newest first.</summary>
    Task<List<FieldPlanDocument>> GetDocumentsAsync(long customerId, int? cropYear, CancellationToken cancellationToken);

    /// <summary>The producer's document with this Doc Store id; null when it's another producer's or doesn't exist.</summary>
    Task<FieldPlanDocument?> GetDocumentAsync(long customerId, string docStoreId, CancellationToken cancellationToken);

    /// <summary>The current (not overwritten or archived) documents of one type saved from a field's 45Z record.</summary>
    Task<List<FieldPlanDocument>> GetCurrentRecordDocumentsAsync(int fieldProgramRecordId, string documentType, CancellationToken cancellationToken);

    /// <summary>The commodity code of each crop row in one query, deleted rows included; ids that don't exist are absent.</summary>
    Task<Dictionary<int, string?>> GetPlantingIntentionCropsAsync(IReadOnlyCollection<int> plantingIntentionIds, CancellationToken cancellationToken);

    void Add<T>(T entity) where T : class;

    Task SaveChangesAsync(CancellationToken cancellationToken);
}
