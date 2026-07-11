using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class FieldTagRepository : IFieldTagRepository
{
    private readonly FieldTagDbContext _context;
    private readonly ILogger<FieldTagRepository> _logger;

    public FieldTagRepository(FieldTagDbContext context, ILogger<FieldTagRepository> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<List<CustomerFieldTag>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        return await _context.CustomerFieldTags.AsNoTracking()
            .Where(t => t.CustomerId == customerId && !t.IsDeleted)
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<CustomerFieldTag?> GetActiveByExternalRefAsync(long customerId, string externalRef, CancellationToken cancellationToken)
    {
        return await _context.CustomerFieldTags.AsNoTracking()
            .FirstOrDefaultAsync(t => t.CustomerId == customerId && t.ExternalRef == externalRef && !t.IsDeleted, cancellationToken);
    }

    public async Task<CustomerFieldTag?> GetActiveByIdAsync(long customerId, int id, CancellationToken cancellationToken)
    {
        return await _context.CustomerFieldTags.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == id && t.CustomerId == customerId && !t.IsDeleted, cancellationToken);
    }

    public async Task<CustomerFieldTag> AddAsync(CustomerFieldTag tag, CancellationToken cancellationToken)
    {
        _context.CustomerFieldTags.Add(tag);
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Created field tag {TagId} for customer {CustomerId}", tag.Id, tag.CustomerId);
        return tag;
    }

    public async Task<bool> DeleteAsync(long customerId, int id, string currentUser, CancellationToken cancellationToken)
    {
        var tag = await _context.CustomerFieldTags
            .FirstOrDefaultAsync(t => t.Id == id && t.CustomerId == customerId && !t.IsDeleted, cancellationToken);
        if (tag == null)
        {
            return false;
        }

        tag.IsDeleted = true;
        tag.DeletedAt = DateTime.UtcNow;
        tag.DeletedBy = currentUser;
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Soft-deleted field tag {TagId} for customer {CustomerId}", id, customerId);
        return true;
    }
}
