using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class CustomerSyncRepository : ICustomerSyncRepository
{
    private readonly OriginationDbContext _odsDb;
    private readonly ApplicationDbContext _appDb;

    public CustomerSyncRepository(OriginationDbContext odsDb, ApplicationDbContext appDb)
    {
        _odsDb = odsDb;
        _appDb = appDb;
    }

    public Task<List<CustomerTradeUnitView>> LoadOdsTradeUnitRowsAsync(CancellationToken cancellationToken) =>
        _odsDb.CustomerTradeUnits.AsNoTracking().ToListAsync(cancellationToken);

    public Task<List<Customer>> LoadAppCustomersAsync(CancellationToken cancellationToken) =>
        _appDb.Customers.ToListAsync(cancellationToken);

    public Task<List<CustomerTradeUnit>> LoadAppTradeUnitsAsync(CancellationToken cancellationToken) =>
        _appDb.CustomerTradeUnits.ToListAsync(cancellationToken);

    public async Task<List<CurrentCustomerRow>> LoadCurrentCustomerMasterAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken)
    {
        if (customerIds.Count == 0) return [];

        // base.vw_CurrentCustomers is a heavy view (~20s even for a single id), so give it a generous
        // timeout — matches the 120s used for other heavy ODS reads. Nightly job, off the request path.
        _odsDb.Database.SetCommandTimeout(120);
        var idCsv = string.Join(",", customerIds);
        return await _odsDb.Database
            .SqlQueryRaw<CurrentCustomerRow>(@"
                SELECT
                    c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1,
                    c.MerchandisingCity, c.MerchandisingStateProvince, c.MerchandisingAddressLine1, c.MerchandisingPostalCode,
                    c.MerchandisingPhone, c.MerchandisingEmail, c.ExtendedPrimaryPhone, c.SupplementalEmail,
                    c.ExtendedAddressLine1, c.ExtendedAddressLine2, c.ExtendedAddressLine3, c.ExtendedAddressLine4,
                    c.ExtendedCity, c.ExtendedPostalCode, c.ExtendedStateProvince, c.ExtendedCountry,
                    c.EffectiveStartDate, c.EffectiveEndDate
                FROM base.vw_CurrentCustomers c
                WHERE c.CustomerId IN (SELECT TRY_CAST(value AS bigint) FROM STRING_SPLIT(@ids, ','))",
                new SqlParameter("@ids", idCsv))
            .ToListAsync(cancellationToken);
    }

    public void AddCustomer(Customer customer) => _appDb.Customers.Add(customer);

    public void AddTradeUnit(CustomerTradeUnit tradeUnit) => _appDb.CustomerTradeUnits.Add(tradeUnit);

    public Task SaveChangesAsync(CancellationToken cancellationToken) => _appDb.SaveChangesAsync(cancellationToken);
}

/// <summary>Row shape for the base.vw_CurrentCustomers read in the manual-producer refresh pass.
/// Property names match the selected columns so EF's SqlQueryRaw can bind them, and it implements
/// <see cref="ICustomerOdsAttributes"/> so the sync can reuse its attribute-copy helper.</summary>
public sealed class CurrentCustomerRow : ICustomerOdsAttributes
{
    public long CustomerId { get; set; }
    public string? ScoularId { get; set; }
    public string? CustomerName { get; set; }
    public string? IndustryCode1 { get; set; }
    public string? MerchandisingCity { get; set; }
    public string? MerchandisingStateProvince { get; set; }
    public string? MerchandisingAddressLine1 { get; set; }
    public string? MerchandisingPostalCode { get; set; }
    public string? MerchandisingPhone { get; set; }
    public string? MerchandisingEmail { get; set; }
    public string? ExtendedPrimaryPhone { get; set; }
    public string? SupplementalEmail { get; set; }
    public string? ExtendedAddressLine1 { get; set; }
    public string? ExtendedAddressLine2 { get; set; }
    public string? ExtendedAddressLine3 { get; set; }
    public string? ExtendedAddressLine4 { get; set; }
    public string? ExtendedCity { get; set; }
    public string? ExtendedPostalCode { get; set; }
    public string? ExtendedStateProvince { get; set; }
    public string? ExtendedCountry { get; set; }
    public DateTime? EffectiveStartDate { get; set; }
    public DateTime? EffectiveEndDate { get; set; }
}
