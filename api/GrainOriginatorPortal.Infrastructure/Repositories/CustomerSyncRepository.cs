using GrainOriginatorPortal.Infrastructure.Abstractions;
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
                    c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1, c.IndustryCode2, c.NopIdNumber,
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
