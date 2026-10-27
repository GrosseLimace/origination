using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Everything one producer has in the field plan, across all years.</summary>
public sealed record FieldPlanRows(
    IReadOnlyList<ProducerField> Fields,
    IReadOnlyList<ProducerFieldSeason> Seasons,
    IReadOnlyList<FieldProgramRecord> Records,
    IReadOnlyList<ProgramEnrollment> Enrollments);

/// <summary>
/// Data access for the field plan. Reads for a single row return it TRACKED (with its parents loaded) so
/// the service can change it and call <see cref="SaveChangesAsync"/>; the service owns every rule.
/// Removed seasons and records are hidden by the model's soft-delete filters.
/// </summary>
public interface IFieldPlanRepository
{
    /// <summary>The producer's fields, seasons, records and enrollments (withdrawn included), untracked.</summary>
    Task<FieldPlanRows> LoadAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>The field for a split ID, whichever producer holds it.</summary>
    Task<ProducerField?> GetFieldAsync(string splitId, CancellationToken cancellationToken);

    /// <summary>A season with its field.</summary>
    Task<ProducerFieldSeason?> GetSeasonAsync(int seasonId, CancellationToken cancellationToken);

    Task<List<FieldProgramRecord>> GetRecordsForSeasonAsync(int seasonId, CancellationToken cancellationToken);

    /// <summary>A record with its season and field.</summary>
    Task<FieldProgramRecord?> GetRecordAsync(int recordId, CancellationToken cancellationToken);

    Task<FieldProgramRecord?> GetRecordAsync(int seasonId, string programKey, CancellationToken cancellationToken);

    Task<ProgramEnrollment?> GetEnrollmentAsync(Guid key, CancellationToken cancellationToken);

    /// <summary>The producer's Open or Attested enrollment in a program for a year.</summary>
    Task<ProgramEnrollment?> GetLiveEnrollmentAsync(long customerId, string programKey, int cropYear, CancellationToken cancellationToken);

    /// <summary>Every producer's attested enrollments in a program for a year (the duplicate-claim check).</summary>
    Task<List<ProgramEnrollment>> GetAttestedAsync(string programKey, int cropYear, CancellationToken cancellationToken);

    /// <summary>Whether the planting intention exists, belongs to the producer and is for that year.</summary>
    Task<bool> PlantingIntentionMatchesAsync(int plantingIntentionId, long customerId, int cropYear, CancellationToken cancellationToken);

    void Add<T>(T entity) where T : class;

    Task SaveChangesAsync(CancellationToken cancellationToken);
}
