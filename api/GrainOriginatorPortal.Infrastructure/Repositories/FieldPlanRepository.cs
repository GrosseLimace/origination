using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

/// <inheritdoc />
public class FieldPlanRepository : IFieldPlanRepository
{
    private readonly ApplicationDbContext _db;

    public FieldPlanRepository(ApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<FieldPlanRows> LoadAsync(long customerId, CancellationToken cancellationToken)
    {
        var fields = await _db.ProducerFields.AsNoTracking()
            .Where(f => f.CustomerId == customerId)
            .OrderBy(f => f.SplitId)
            .ToListAsync(cancellationToken);
        var fieldIds = fields.Select(f => f.Id).ToList();
        var seasons = await _db.ProducerFieldSeasons.AsNoTracking()
            .Where(s => fieldIds.Contains(s.ProducerFieldId))
            .OrderBy(s => s.Id)
            .ToListAsync(cancellationToken);
        var seasonIds = seasons.Select(s => s.Id).ToList();
        var records = await _db.FieldProgramRecords.AsNoTracking()
            .Where(r => seasonIds.Contains(r.ProducerFieldSeasonId))
            .OrderBy(r => r.Id)
            .ToListAsync(cancellationToken);
        var enrollments = await _db.ProgramEnrollments.AsNoTracking()
            .Where(e => e.CustomerId == customerId)
            .OrderBy(e => e.Id)
            .ToListAsync(cancellationToken);
        return new FieldPlanRows(fields, seasons, records, enrollments);
    }

    public Task<ProducerField?> GetFieldAsync(string splitId, CancellationToken cancellationToken) =>
        _db.ProducerFields.FirstOrDefaultAsync(f => f.SplitId == splitId, cancellationToken);

    public Task<ProducerFieldSeason?> GetSeasonAsync(int seasonId, CancellationToken cancellationToken) =>
        _db.ProducerFieldSeasons.Include(s => s.Field).FirstOrDefaultAsync(s => s.Id == seasonId, cancellationToken);

    public Task<List<FieldProgramRecord>> GetRecordsForSeasonAsync(int seasonId, CancellationToken cancellationToken) =>
        _db.FieldProgramRecords.Where(r => r.ProducerFieldSeasonId == seasonId).ToListAsync(cancellationToken);

    public Task<FieldProgramRecord?> GetRecordAsync(int recordId, CancellationToken cancellationToken) =>
        _db.FieldProgramRecords.Include(r => r.Season).ThenInclude(s => s!.Field)
            .FirstOrDefaultAsync(r => r.Id == recordId, cancellationToken);

    public Task<FieldProgramRecord?> GetRecordAsync(int seasonId, string programKey, CancellationToken cancellationToken) =>
        _db.FieldProgramRecords.FirstOrDefaultAsync(r => r.ProducerFieldSeasonId == seasonId && r.ProgramKey == programKey, cancellationToken);

    public Task<ProgramEnrollment?> GetEnrollmentAsync(Guid key, CancellationToken cancellationToken) =>
        _db.ProgramEnrollments.FirstOrDefaultAsync(e => e.EnrollmentKey == key, cancellationToken);

    public Task<ProgramEnrollment?> GetLiveEnrollmentAsync(long customerId, string programKey, int cropYear, CancellationToken cancellationToken) =>
        _db.ProgramEnrollments.FirstOrDefaultAsync(e => e.CustomerId == customerId && e.ProgramKey == programKey
            && e.CropYear == cropYear && e.Status != "Withdrawn", cancellationToken);

    public Task<List<ProgramEnrollment>> GetAttestedAsync(string programKey, int cropYear, CancellationToken cancellationToken) =>
        _db.ProgramEnrollments.AsNoTracking()
            .Where(e => e.ProgramKey == programKey && e.CropYear == cropYear && e.Status == "Attested")
            .ToListAsync(cancellationToken);

    public Task<bool> PlantingIntentionMatchesAsync(int plantingIntentionId, long customerId, int cropYear, CancellationToken cancellationToken) =>
        _db.PlantingIntentions.AnyAsync(p => p.Id == plantingIntentionId && p.CustomerId == customerId && p.PlantingYear == cropYear, cancellationToken);

    public Task<bool> CustomerExistsAsync(long customerId, CancellationToken cancellationToken) =>
        _db.Customers.AnyAsync(c => c.Id == customerId, cancellationToken);

    public Task<string?> GetPlantingIntentionCropAsync(int plantingIntentionId, CancellationToken cancellationToken) =>
        _db.PlantingIntentions.IgnoreQueryFilters().Where(p => p.Id == plantingIntentionId).Select(p => p.Crop).FirstOrDefaultAsync(cancellationToken);

    public void Add<T>(T entity) where T : class => _db.Add(entity);

    public Task SaveChangesAsync(CancellationToken cancellationToken) => _db.SaveChangesAsync(cancellationToken);
}
