using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Repositories;

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
        return new FieldPlanRows(fields, seasons, records);
    }

    public Task<ProducerField?> GetFieldAsync(string splitId, CancellationToken cancellationToken) =>
        _db.ProducerFields.FirstOrDefaultAsync(f => f.SplitId == splitId, cancellationToken);

    public Task<ProducerFieldSeason?> GetSeasonAsync(int seasonId, CancellationToken cancellationToken) =>
        _db.ProducerFieldSeasons.Include(s => s.Field).FirstOrDefaultAsync(s => s.Id == seasonId, cancellationToken);

    public Task<List<ProducerFieldSeason>> GetSeasonsForFieldAsync(int producerFieldId, int cropYear, CancellationToken cancellationToken) =>
        _db.ProducerFieldSeasons.Where(s => s.ProducerFieldId == producerFieldId && s.CropYear == cropYear).ToListAsync(cancellationToken);

    public Task<List<FieldProgramRecord>> GetConfirmedRecordsForFieldAsync(int producerFieldId, CancellationToken cancellationToken) =>
        _db.FieldProgramRecords.Include(r => r.Season)
            .Where(r => r.Season!.ProducerFieldId == producerFieldId && r.Official != null)
            .ToListAsync(cancellationToken);

    public Task<List<FieldProgramRecord>> GetRecordsForSeasonAsync(int seasonId, CancellationToken cancellationToken) =>
        _db.FieldProgramRecords.Where(r => r.ProducerFieldSeasonId == seasonId).ToListAsync(cancellationToken);

    public Task<FieldProgramRecord?> GetRecordAsync(int recordId, CancellationToken cancellationToken) =>
        _db.FieldProgramRecords.Include(r => r.Season).ThenInclude(s => s!.Field)
            .FirstOrDefaultAsync(r => r.Id == recordId, cancellationToken);

    public Task<FieldProgramRecord?> GetRecordAsync(int seasonId, string programKey, CancellationToken cancellationToken) =>
        _db.FieldProgramRecords.FirstOrDefaultAsync(r => r.ProducerFieldSeasonId == seasonId && r.ProgramKey == programKey, cancellationToken);

    public Task<bool> PlantingIntentionMatchesAsync(int plantingIntentionId, long customerId, int cropYear, CancellationToken cancellationToken) =>
        _db.PlantingIntentions.AnyAsync(p => p.Id == plantingIntentionId && p.CustomerId == customerId && p.PlantingYear == cropYear, cancellationToken);

    public Task<bool> CustomerExistsAsync(long customerId, CancellationToken cancellationToken) =>
        _db.Customers.AnyAsync(c => c.Id == customerId, cancellationToken);

    public async Task<(bool Exists, string? ScoularId)> GetCustomerCodeAsync(long customerId, CancellationToken cancellationToken)
    {
        var row = await _db.Customers.Where(c => c.Id == customerId).Select(c => new { c.ScoularId }).FirstOrDefaultAsync(cancellationToken);
        return (row is not null, row?.ScoularId);
    }

    public Task<string?> GetPlantingIntentionCropAsync(int plantingIntentionId, CancellationToken cancellationToken) =>
        _db.PlantingIntentions.IgnoreQueryFilters().Where(p => p.Id == plantingIntentionId).Select(p => p.Crop).FirstOrDefaultAsync(cancellationToken);

    public Task<List<FieldPlanDocument>> GetDocumentsAsync(long customerId, int? cropYear, CancellationToken cancellationToken) =>
        _db.FieldPlanDocuments
            .Where(d => d.CustomerId == customerId && (cropYear == null || d.CropYear == cropYear))
            .OrderByDescending(d => d.CreatedAt).ThenByDescending(d => d.Id)
            .ToListAsync(cancellationToken);

    public Task<FieldPlanDocument?> GetDocumentAsync(long customerId, string docStoreId, CancellationToken cancellationToken) =>
        _db.FieldPlanDocuments.FirstOrDefaultAsync(d => d.CustomerId == customerId && d.DocStoreId == docStoreId, cancellationToken);

    public Task<List<FieldPlanDocument>> GetCurrentRecordDocumentsAsync(int fieldProgramRecordId, string documentType, CancellationToken cancellationToken) =>
        _db.FieldPlanDocuments
            .Where(d => d.FieldProgramRecordId == fieldProgramRecordId && d.DocumentType == documentType && d.Status == FieldPlanDocument.Current)
            .ToListAsync(cancellationToken);

    public Task<Dictionary<int, string?>> GetPlantingIntentionCropsAsync(IReadOnlyCollection<int> plantingIntentionIds, CancellationToken cancellationToken) =>
        _db.PlantingIntentions.IgnoreQueryFilters().Where(p => plantingIntentionIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => (string?)p.Crop, cancellationToken);

    public void Add<T>(T entity) where T : class => _db.Add(entity);

    public Task SaveChangesAsync(CancellationToken cancellationToken) => _db.SaveChangesAsync(cancellationToken);
}
