# Recon dossier: customers from ODS to GraphQL (worktree `C:\Users\CEgr\Projects\Origination-customers`, branch `feature_CustomersFromGraphQL`, HEAD `d5f16f04`)

Nothing was modified. The only untracked path is `agents-docs/questions/` (the orchestrator's goal statement and hand-off log).

Path shorthand used below:
- `API` = `api/GrainOriginatorPortal.Api`
- `INF` = `api/GrainOriginatorPortal.Infrastructure`
- `TEST` = `api/GrainOriginatorPortal.Api.Tests/GrainOriginatorPortal.Api.Tests`
- `CL` = `client/src/app`

---

## 1. CUSTOMER SYNC TODAY

### 1.1 Registration and scheduling
- `API/Program.cs:143-148`:
```csharp
builder.Services.AddSingleton<CustomerSyncService>();
builder.Services.AddHostedService<CustomerSyncBackgroundService>();
```
- `INF/DependencyInjection.cs:165`: `services.AddScoped<ICustomerSyncRepository, CustomerSyncRepository>();`
- `CustomerSyncService` is a singleton. It creates a scope per run through `IServiceScopeFactory` and resolves `ICustomerSyncRepository` and `ICustomerRepository` from that scope.
- `CustomerSyncBackgroundService : BackgroundService` is at `API/Services/CustomerSyncBackgroundService.cs`:
```csharp
public CustomerSyncBackgroundService(CustomerSyncService sync, IConfiguration config, ILogger<CustomerSyncBackgroundService> logger)
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
private async Task RunSyncSafelyAsync(CancellationToken stoppingToken, string reason)
private static DateTime ComputeNextRunUtc(TimeOnly scheduledUtc)
```
- Run flow, `CustomerSyncBackgroundService.cs:33-84`:
  1. It reads `CustomerSync:RunAtTimeUtc`, trimmed. Empty or `"0"` means disabled: it logs and returns, so there is no startup run either.
  2. An invalid `TimeOnly` logs a warning and returns.
  3. It waits `Task.Delay(TimeSpan.FromSeconds(60))`, then runs `RunSyncSafelyAsync(stoppingToken, "startup")`.
  4. It then loops: compute the next UTC HH:mm, delay, then `RunSyncSafelyAsync(..., "scheduled")`.
- `RunSyncSafelyAsync` opens a logging scope with `ServiceName`, `Operation = $"CustomerSync.{reason}"` and `TraceId = Guid.NewGuid().ToString("N")`. It swallows exceptions with `LogError(ex, "CustomerSync {Reason} cycle failed — will retry at next scheduled run", reason)`. There is no retry before the next day.
- Config: `RunAtTimeUtc` is "07:00" in `appsettings.json:23` and `appsettings.Development.json:38`. Dev, QA and Production files have no `CustomerSync` section, so they inherit 07:00. The only `CustomerSync:*` key is `RunAtTimeUtc`.
- Manual trigger, `API/Controllers/DiagnosticsController.cs:561`:
```csharp
[HttpPost("customer-sync/run")]
[ProducesResponseType(typeof(CustomerSyncResult), StatusCodes.Status200OK)]
public async Task<IActionResult> RunCustomerSync(CancellationToken cancellationToken = default)
{ var result = await _customerSync.SyncAsync(cancellationToken); return Ok(result); }
```
  - The controller is `[Authorize(Policy = "AdminOnly")]`.
  - This route has NO `DenyIf...` gate, so it works in PROD.
  - `CustomerSyncService` is injected directly into `DiagnosticsController`.

### 1.2 `CustomerSyncService` (`API/Services/CustomerSyncService.cs`, 386 lines)
```csharp
public class CustomerSyncService
{
    private const string SyncActor = "system";
    public CustomerSyncService(IServiceScopeFactory scopeFactory, ILogger<CustomerSyncService> logger)
    public async Task<CustomerSyncResult> SyncAsync(CancellationToken cancellationToken = default)
    private static void ApplyAttributes(Customer target, ICustomerOdsAttributes source)
}
public class CustomerSyncResult {
    public int CustomersInserted, CustomersUpdated, CustomersReactivated, CustomersDeactivated;
    public int TradeUnitsInserted, TradeUnitsUpdated, TradeUnitsDeactivated;
    public int TradeUnitsBroughtBack;            // user-removed dormant TUs restored once activity returned
    public int ManualCustomersRefreshed, ManualCustomersReactivated, ManualCustomersDeactivated;
    public long ElapsedMs; public DateTime CompletedAtUtc;   // all { get; set; }
}
```

Flow of `SyncAsync`. Line numbers are in `CustomerSyncService.cs`.

1. **Load ODS rows (l.54).** `var odsRows = await repo.LoadOdsTradeUnitRowsAsync(ct);` This returns one row per (CustomerId, TradeUnit) from `originations.vw_CustomerTradeUnits`.
2. **Collapse to customers (l.62-64).** The ODS rows are grouped and collapsed:
```csharp
var odsCustomersByCustomerId = odsRows.GroupBy(o => o.CustomerId).ToDictionary(g => g.Key, g => g.First());
```
3. **Load app state, tracked (l.69-77).**
   - `appCustomers` is every `dbo.Customer` row, including inactive and manual ones, keyed by `c.Id`.
   - `appTradeUnits` is every `dbo.CustomerTradeUnit` row, keyed by `(CustomerId, TradeUnit)`.
4. **Customer upsert (l.82-110).** Matching is by `Id` (ODS `CustomerId`). It is NOT by ScoularId.
   - Existing customer: `ApplyAttributes(existing, odsRow)`. If `existing.IsManual` it is set to false ("graduation"). If `!IsActive`, set `IsActive = true` and `CustomersReactivated++`, else `CustomersUpdated++`.
   - New customer: `var inserted = odsRow.ToCustomer(); inserted.IsActive = true; repo.AddCustomer(inserted);` with `CustomersInserted++`.
5. **Customer soft-delete (l.117-124).**
```csharp
if (!odsCustomersByCustomerId.ContainsKey(existing.Id) && existing.IsActive && !existing.IsManual)
{ existing.IsActive = false; result.CustomersDeactivated++; }
```
6. **TU upsert (l.133-188).**
   - Source rows: `odsRows.Where(o => !string.IsNullOrEmpty(o.TradeUnit)).GroupBy(o => (o.CustomerId, TradeUnit: o.TradeUnit!))`.
   - If the existing row has `UserDeactivated`, `continue`. It is not reactivated and not re-locked.
   - Otherwise: if `!IsActive`, set `IsActive = true`. If `IsManual`, set `IsManual = false`. If anything changed, stamp `ModifiedAt = syncTime; ModifiedBy = "system"` and `TradeUnitsUpdated++`.
   - Missing row: `repo.AddTradeUnit(new CustomerTradeUnit { CustomerId, TradeUnit, IsActive = true, CreatedAt = syncTime, CreatedBy = "system" })`.
7. **TU soft-delete (l.193-203).** The condition is `!odsTradeUnitsByKey.ContainsKey(key) && existing.IsActive && !existing.IsManual`. It sets `IsActive = false` and stamps `ModifiedAt/ModifiedBy`.
8. **Manual-producer refresh pass (l.218-251).**
   - It selects `appCustomers.Where(c => c.IsManual && !odsCustomersByCustomerId.ContainsKey(c.Id))`.
   - It calls `repo.LoadCurrentCustomerMasterAsync(ids, ct)`, which reads `base.vw_CurrentCustomers` by `CustomerId`.
   - A row found in the master gets `ApplyAttributes` and is reactivated if inactive.
   - A row not in the master and still active gets `IsActive = false` (`ManualCustomersDeactivated++`).
9. **Bring-back pass (l.271-298).**
   - For TU rows where `UserDeactivated` is true, it calls `customerRepository.GetOpenActivityTradeUnitsAsync(cust.ScoularId, ct)`. That method reads contracts and tickets through the Ctrm switch.
   - If the TU is in the open-activity set it sets `UserDeactivated = false; IsActive = true; IsManual = false; ModifiedAt/By` and `TradeUnitsBroughtBack++`.
10. **Persist (l.311).** A single `repo.SaveChangesAsync`. There is no explicit transaction. The comment says EF's retrying execution strategy covers it.

**Mass-deactivation guard: NONE exists.** Evidence: no count, percentage or empty-source check anywhere in the service. `docs/operations/OUTAGE-RECOVERY-PLAYBOOK.md:90` states "it has **no guard against an empty or partial view**", and `:388` lists "A 'refuse to deactivate more than X%' check would remove it" under Known gaps.

`ApplyAttributes`, verbatim field mapping (`CustomerSyncService.cs:342-367`):
```csharp
target.Name = source.CustomerName ?? string.Empty;  target.ScoularId = source.ScoularId;
target.IndustryCode1 = source.IndustryCode1;  target.IndustryCode2 = source.IndustryCode2;
target.NopIdNumber = OdsValues.NormaliseNopId(source.NopIdNumber);
target.EffectiveStartDate/EndDate = source.EffectiveStartDate/EndDate;
target.Phone = source.MerchandisingPhone;  target.Email = source.MerchandisingEmail;
target.ExtendedPrimaryPhone = source.ExtendedPrimaryPhone;  target.SupplementalEmail = source.SupplementalEmail;
target.Location = source.MerchandisingCity;  target.StateProvince = source.MerchandisingStateProvince;
target.AddressLine1 = source.MerchandisingAddressLine1;  target.PostalCode = source.MerchandisingPostalCode;
target.ExtendedAddressLine1..4, ExtendedCity, ExtendedPostalCode, ExtendedStateProvince, ExtendedCountry = same-named source
```
Not mapped by the sync: `IsManual`, `IsActive` (set by the passes), `Id`, MerchandisingAddressLine2 (there is no entity column), MerchandisingCountry (there is no entity column).

### 1.3 `ICustomerSyncRepository` (`INF/Interfaces/ICustomerSyncRepository.cs`)
```csharp
Task<List<CustomerTradeUnitView>> LoadOdsTradeUnitRowsAsync(CancellationToken cancellationToken);
Task<List<Customer>> LoadAppCustomersAsync(CancellationToken cancellationToken);
Task<List<CustomerTradeUnit>> LoadAppTradeUnitsAsync(CancellationToken cancellationToken);
Task<List<CurrentCustomerRow>> LoadCurrentCustomerMasterAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken);
void AddCustomer(Customer customer);
void AddTradeUnit(CustomerTradeUnit tradeUnit);
Task SaveChangesAsync(CancellationToken cancellationToken);
```
`INF/Repositories/CustomerSyncRepository.cs`:
```csharp
public CustomerSyncRepository(OriginationDbContext odsDb, ApplicationDbContext appDb)
public Task<List<CustomerTradeUnitView>> LoadOdsTradeUnitRowsAsync(CancellationToken ct) => _odsDb.CustomerTradeUnits.AsNoTracking().ToListAsync(ct);
public Task<List<Customer>> LoadAppCustomersAsync(...) => _appDb.Customers.ToListAsync(ct);          // tracked
public Task<List<CustomerTradeUnit>> LoadAppTradeUnitsAsync(...) => _appDb.CustomerTradeUnits.ToListAsync(ct); // tracked
```
`LoadCurrentCustomerMasterAsync` does `_odsDb.Database.SetCommandTimeout(120);` and builds `idCsv = string.Join(",", customerIds)`. It then runs `SqlQueryRaw<CurrentCustomerRow>` with:
```sql
SELECT c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1, c.IndustryCode2, c.NopIdNumber,
 c.MerchandisingCity, c.MerchandisingStateProvince, c.MerchandisingAddressLine1, c.MerchandisingPostalCode,
 c.MerchandisingPhone, c.MerchandisingEmail, c.ExtendedPrimaryPhone, c.SupplementalEmail,
 c.ExtendedAddressLine1, c.ExtendedAddressLine2, c.ExtendedAddressLine3, c.ExtendedAddressLine4,
 c.ExtendedCity, c.ExtendedPostalCode, c.ExtendedStateProvince, c.ExtendedCountry,
 c.EffectiveStartDate, c.EffectiveEndDate
FROM base.vw_CurrentCustomers c
WHERE c.CustomerId IN (SELECT TRY_CAST(value AS bigint) FROM STRING_SPLIT(@ids, ','))
```
The view takes about 20 s even for one id. The comment calls it a "heavy view".

### 1.4 Row types and normaliser
- `INF/Abstractions/CurrentCustomerRow.cs`: `public sealed class CurrentCustomerRow : ICustomerOdsAttributes`.
  - Properties: `long CustomerId`; `string? ScoularId, CustomerName, IndustryCode1, IndustryCode2, NopIdNumber, MerchandisingCity, MerchandisingStateProvince, MerchandisingAddressLine1, MerchandisingPostalCode, MerchandisingPhone, MerchandisingEmail, ExtendedPrimaryPhone, SupplementalEmail, ExtendedAddressLine1..4, ExtendedCity, ExtendedPostalCode, ExtendedStateProvince, ExtendedCountry`; `DateTime? EffectiveStartDate, EffectiveEndDate`.
- `INF/Data/Entities/ICustomerOdsAttributes.cs` (all getters, no `CustomerId`, no IsActive):
```csharp
string? CustomerName; ScoularId; MerchandisingPhone; MerchandisingEmail; ExtendedPrimaryPhone; SupplementalEmail;
MerchandisingCity; MerchandisingStateProvince; MerchandisingAddressLine1; MerchandisingPostalCode;
ExtendedAddressLine1; ExtendedAddressLine2; ExtendedAddressLine3; ExtendedAddressLine4; ExtendedCity;
ExtendedStateProvince; ExtendedPostalCode; ExtendedCountry; IndustryCode1; IndustryCode2; NopIdNumber;
DateTime? EffectiveStartDate; DateTime? EffectiveEndDate;
```
- `INF/Data/OdsValues.cs`:
```csharp
public static string? NormaliseNopId(string? raw)
```
  - It trims. Anything other than exactly 10 ASCII digits becomes null. A run of one repeated digit (for example `9999999999`) becomes null.
  - Pinned by the `NormalisesTheNopIdToTenDigitsOrNothing` theory in `TEST/Services/CustomerTradeUnitViewContractTests.cs`.
- `INF/Data/Entities/CustomerTradeUnitView.cs`:
  - `public class CustomerTradeUnitView : ICustomerOdsAttributes`.
  - Properties: `long CustomerId`, every `ICustomerOdsAttributes` property, and `string? TradeUnit`.
  - `public Customer ToCustomer() => new Customer { Id = CustomerId, Name = CustomerName ?? string.Empty, ScoularId, Phone = MerchandisingPhone, Email = MerchandisingEmail, ..., NopIdNumber = OdsValues.NormaliseNopId(NopIdNumber), EffectiveStartDate, EffectiveEndDate }`. It leaves `IsActive` unset (false); the sync sets it.
  - Contract tests forbid `IsActive` and `IsDeleted` properties on the view type and on `ICustomerOdsAttributes`. `TEST/Services/CustomerTradeUnitViewContractTests.cs` guards this with the rationale "a property EF can't find in the view fails the whole query".
- `OriginationDbContext.cs:57-66`:
```csharp
modelBuilder.Entity<CustomerTradeUnitView>(entity => {
  entity.ToView("vw_CustomerTradeUnits", schema: "originations"); entity.HasNoKey();
  entity.Property(e => e.ScoularId).HasColumnName("SourceCustomerId"); });
```

### 1.5 App-DB entities and mappings

`Customer` (`INF/Data/Entities/Customer.cs`, `public long Id { get; set; }`) has these persisted properties:
- Identity and names: `ScoularId`, `Name`, `Location`, `StateProvince`, `AddressLine1`, `PostalCode`.
- Contacts and extended address: `Phone`, `Email`, `ExtendedPrimaryPhone`, `SupplementalEmail`, `ExtendedAddressLine1..4`, `ExtendedCity`, `ExtendedPostalCode`, `ExtendedStateProvince`, `ExtendedCountry`.
- Codes and flags: `IndustryCode1`, `IndustryCode2`, `NopIdNumber`, `IsActive`, `IsManual`.
- Dates: `EffectiveStartDate`, `EffectiveEndDate`.

Transient, `Ignore()`d properties: `CustomerCode, Farm, TotalAcres, ESignEnabled, AchEnabled, ActiveTradeUnits, ScoularViewRecipients, Guild, Coordinates, FarmIds, LinkedProducerIds`.

`ApplicationDbContext.cs:458-514`, `Customer`:
```csharp
entity.ToTable("Customer", schema: "dbo"); entity.HasKey(e => e.Id);
// Id is the ODS CustomerId — not auto-generated; provided by sync.
entity.Property(e => e.Id).HasColumnName("CustomerId").ValueGeneratedNever().IsRequired();
entity.Property(e => e.Name).HasColumnName("CustomerName").HasMaxLength(500).IsRequired();
entity.Property(e => e.ScoularId).HasColumnName("ScoularId").HasMaxLength(400).IsRequired(false).HasConversion(v => v, v => v != null ? v.Trim() : v);
IndustryCode1 max 50; IndustryCode2 max 100; NopIdNumber max 100;
IsActive HasDefaultValue(true).IsRequired(); IsManual HasDefaultValue(false).IsRequired();
Phone->"MerchandisingPhone"(100), Email->"MerchandisingEmail"(255), ExtendedPrimaryPhone(100), SupplementalEmail(255),
Location->"MerchandisingCity"(255), StateProvince->"MerchandisingStateProvince"(50), AddressLine1->"MerchandisingAddressLine1"(255), PostalCode->"MerchandisingPostalCode"(20),
ExtendedAddressLine1-4 (255), ExtendedCity(255), ExtendedPostalCode(20), ExtendedStateProvince(50), ExtendedCountry(255)
entity.HasIndex(e => e.Name).HasDatabaseName("IX_Customer_CustomerName");
entity.HasIndex(e => e.ScoularId).HasDatabaseName("IX_Customer_ScoularId");   // NON-unique
```
No unique constraint exists on `ScoularId`.

`CustomerTradeUnit` (`INF/Data/Entities/CustomerTradeUnit.cs`):
```csharp
public int Id; public long CustomerId; public string TradeUnit = string.Empty; public bool IsActive;
public bool IsManual; public bool UserDeactivated;
public DateTime CreatedAt; public string CreatedBy = string.Empty; public DateTime? ModifiedAt; public string? ModifiedBy;
public Customer? Customer { get; set; }
```
`ApplicationDbContext.cs:516-552`:
```csharp
Id ValueGeneratedOnAdd; TradeUnit HasMaxLength(100) required; IsActive default true; IsManual default false; UserDeactivated default false;
CreatedAt HasDefaultValueSql("GETUTCDATE()"); CreatedBy max 255 required; ModifiedBy max 255
entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId).OnDelete(DeleteBehavior.Cascade);
entity.HasIndex(e => new { e.CustomerId, e.TradeUnit }).IsUnique().HasDatabaseName("UQ_CustomerTradeUnit_CustomerId_TradeUnit");
entity.HasIndex(e => new { e.TradeUnit, e.IsActive }).HasDatabaseName("IX_CustomerTradeUnit_TradeUnit_IsActive");
```
FKs to `Customer.Id`: `HasForeignKey(e => e.CustomerId)` appears 8 times in `ApplicationDbContext.cs` (lines 109, 156, 219, 345, 389, 419, 444, 540). `CustomerLink` has `FromCustomerId` and `ToCustomerId` (lines 362, 367). `OriginationDbContext` declares no `HasOne<Customer>` (lines 156 and 229 are comments).

---

## 2. CUSTOMER READS TODAY

### 2.1 `ICustomerRepository` (`INF/Interfaces/ICustomerRepository.cs`)
```csharp
Task<List<Customer>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
Task<List<Customer>> SearchAsync(string searchTerm, List<string>? tradeUnits, CancellationToken cancellationToken);
Task<List<Customer>> SearchOdsAsync(string searchTerm, CancellationToken cancellationToken);
Task<Customer?> GetByIdAsync(long id, CancellationToken cancellationToken);
Task<Customer?> GetByScoularIdAsync(string scoularId, CancellationToken cancellationToken);
Task<List<Customer>> GetLinkedToAsync(string scoularId, CancellationToken cancellationToken);
Task<AssignTradeUnitsResult> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, string currentUser, CancellationToken cancellationToken);
Task<List<CustomerTradeUnitMembership>> GetTradeUnitsAsync(long customerId, CancellationToken cancellationToken);
Task<List<CustomerTradeUnitMembership>> GetTradeUnitMembershipsAsync(long customerId, CancellationToken cancellationToken);
Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken);
Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, string currentUser, CancellationToken cancellationToken);
Task<HashSet<long>> GetActiveCustomerIdsInTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, CancellationToken cancellationToken);
Task<string?> GetFirstActiveTradeUnitAsync(long customerId, CancellationToken cancellationToken);
Task<List<string>> GetActiveTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken);
Task<List<string>> GetAllActiveTradeUnitCodesAsync(CancellationToken cancellationToken);
```
`CustomerRepository` (`INF/Repositories/CustomerRepository.cs`) constructor:
```csharp
CustomerRepository(OriginationDbContext context, ApplicationDbContext appContext, ITicketRepository ticketRepository, IContractRepository contractRepository, ILogger<CustomerRepository> logger)
```
The repository is registered scoped (`DependencyInjection.cs:~160`).

### 2.2 `SearchOdsAsync` (`CustomerRepository.cs:~172-251`), the add-customer search
- Terms are split on `' '` and `','`. Zero words returns `[]`. Each word becomes parameter `@w{i}`.
- WHERE clauses (all ANDed):
```sql
c.IndustryCode1 = 'PR'
c.IsActive = 1
c.IsDuplicate = 0
c.CustomerName NOT LIKE '%DUP%'
c.CustomerName NOT LIKE '%DO NOT USE%'
LEFT(c.CustomerName, 1) NOT IN ('*', '$')
-- per word:
( c.CustomerName LIKE '%' + @wN + '%' OR c.ScoularId LIKE '%' + @wN + '%' OR c.SourceCustomerId LIKE '%' + @wN + '%' )
```
- Query:
```sql
SELECT TOP 50 c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1, c.IndustryCode2, c.NopIdNumber,
  c.MerchandisingCity, c.MerchandisingStateProvince, c.MerchandisingAddressLine1, c.MerchandisingPostalCode,
  c.MerchandisingPhone, c.MerchandisingEmail, c.ExtendedPrimaryPhone, c.SupplementalEmail,
  c.ExtendedAddressLine1, c.ExtendedAddressLine2, c.ExtendedAddressLine3, c.ExtendedAddressLine4,
  c.ExtendedCity, c.ExtendedPostalCode, c.ExtendedStateProvince, c.ExtendedCountry,
  c.EffectiveStartDate, c.EffectiveEndDate
FROM base.vw_CurrentCustomers c WHERE {where} ORDER BY c.CustomerName
```
- It runs via `_context.Database.SqlQueryRaw<OdsCustomerRow>(...)` on `OriginationDbContext`.
- Then it drops rows whose `CustomerId` is already in `dbo.Customer` (`_appContext.Customers.Where(c => candidateIds.Contains(c.Id)).Select(c => c.Id)`). Those are not "new".
- `MapOdsRowToCustomer(OdsCustomerRow r)` sets `Id = r.CustomerId`, `ScoularId = r.ScoularId?.Trim()`, `NopIdNumber = NormaliseNopId`, `IsActive = true` and `IsManual = false`. It does not set `AchEnabled`, `ESignEnabled` or `ActiveTradeUnits`.
- `OdsCustomerRow` is a private sealed class with the same 24 properties as `CurrentCustomerRow`.
- Result is capped at 50. The log line avoids the search term because of PII.
- `AssignTradeUnitsAsync` (the onboarding write) re-reads one row by id: `GetOdsCustomerRowAsync(customerId, ct)` runs `SELECT TOP 1 <same 24 cols> FROM base.vw_CurrentCustomers c WHERE c.CustomerId = @customerId`. If it finds one, `inserted = MapOdsRowToCustomer(odsRow); inserted.IsManual = true; inserted.IsActive = true; _appContext.Customers.Add(inserted);`. If not found it returns `AssignTradeUnitsResult.CustomerNotFound`.
- So the onboarding chain depends on the id being the ODS `CustomerId`. The client posts the candidate's `id` to `PUT /customers/{id}/trade-units`.

### 2.3 ACH / eSign / trade-unit enrichment (all private, `CustomerRepository.cs`)
- `GetAsync`, `SearchAsync` and `GetLinkedToAsync` call `EnrichCustomersWithESignAsync`, `EnrichCustomersWithAchAsync` and `EnrichCustomersWithTradeUnitsAsync`.
- `GetByIdAsync` and `GetByScoularIdAsync` do NOT enrich. They return the raw entity: `_appContext.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id)` and `c.ScoularId == scoularId`.
- `SearchOdsAsync` does no enrichment either.
- ACH:
```csharp
public static bool IsAchPaymentMethod(string? paymentMethod) =>
    string.Equals(paymentMethod?.Trim(), "H", StringComparison.OrdinalIgnoreCase);
private async Task EnrichCustomersWithAchAsync(List<Customer> customers, CancellationToken cancellationToken = default)
// ids = customers.Select(c => c.Id).Distinct(); one batched IN query:
var rows = await _context.CustomerPaymentInfos.AsNoTracking()
    .Where(p => p.IsCurrent && ids.Contains(p.CustomerId)).Select(p => new { p.CustomerId, p.PaymentMethod }).ToListAsync(ct);
// achIds = rows where IsAchPaymentMethod -> customer.AchEnabled = true
```
  - `CustomerPaymentInfo` (`INF/Data/Entities/CustomerPaymentInfo.cs`) holds `long CustomerId`, `string? PaymentMethod`, `bool IsCurrent`.
  - It is mapped in `OriginationDbContext.cs:303-310`: `entity.HasNoKey(); entity.ToView("Customer", schema: "base");`. The columns are `CustomerId`, `PaymentMethod` (with a trim conversion) and `IsCurrent`.
  - It is keyed on ODS `CustomerId`, which equals `dbo.Customer.Id`. `TEST/CustomerAchTests.cs` tests `IsAchPaymentMethod`.
- eSign: `EnrichCustomersWithESignAsync` reads `_appContext.ESignEnrollments.Where(e => codes.Contains(e.CustomerCode))`, where `codes` are the customers' `ScoularId`. It is app DB only. No ODS.
- Trade units: `EnrichCustomersWithTradeUnitsAsync` reads `_appContext.CustomerTradeUnits.Where(t => t.IsActive && ids.Contains(t.CustomerId))` and sets `customer.ActiveTradeUnits`.

### 2.4 Other `OriginationDbContext` use in `CustomerRepository`
Only `_context.CustomerPaymentInfos`, `SearchOdsAsync` and `GetOdsCustomerRowAsync`. `GetOpenActivityTradeUnitsAsync` goes through `IContractRepository.GetByCustomerAsync(0, code, ct)` and `ITicketRepository.GetUnappliedByCustomerAsync(0, code, ct)`, which are the switch-backed (CTRM) repositories. It runs them SEQUENTIALLY on purpose: concurrent use of the shared `OriginationDbContext` broke PROD on 2026-09-29.
```csharp
public async Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken)
// contracts: c.ClosedDate is null && !IsNullOrWhiteSpace(c.TradeUnit) -> add c.TradeUnit.Trim()
// tickets:   !IsNullOrWhiteSpace(t.OrganizationCode) -> add t.OrganizationCode.Trim()
```

### 2.5 Controller, service, DTO
`API/Controllers/CustomersController.cs`:
- Class attributes: `[ApiController] [Route("api/[controller]")] [Authorize] [Produces("application/json")]`. The constructor is `CustomersController(ICustomerService service)`.
```csharp
[HttpGet] [EnforceTradeUnitAccess] GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken = default)
[HttpGet("search")] [EnforceTradeUnitAccess] Search([FromQuery] string searchTerm, [FromQuery] List<string>? tradeUnits = null, ...)
private const int MinOdsSearchLength = 3;
[HttpGet("search-ods")] public async Task<ActionResult<List<CustomerResponse>>> SearchOds([FromQuery] string searchTerm, CancellationToken cancellationToken = default)
   // blank or <3 chars after Trim() -> Ok(new List<CustomerResponse>()); else Ok(await _service.SearchOdsAsync(searchTerm, ct)). No EnforceTradeUnitAccess (AR-04).
[HttpGet("{id:long}")] GetById; [HttpGet("by-source/{sourceId}")] GetBySourceId; [HttpGet("linked-to/{sourceId}")] GetLinkedTo
[HttpGet("{id:long}/trade-units")] GetTradeUnits(long id, [FromQuery] bool includeActivity = true, ...)
[HttpPut("{id:long}/trade-units")] AssignTradeUnits(long id, [FromBody] AssignTradeUnitsRequest request, ...)   // AR-03
[HttpDelete("{id:long}/trade-units/{tradeUnit}")] RemoveDormantTradeUnit(long id, string tradeUnit, ...)
```
- The controller comments cite accepted risks AR-02 (no per-producer authz), AR-03 (open trade-unit assignment) and AR-04 (unscoped ODS search returns producer-master PII). These are in `SECURITY-REVIEWS/ACCEPTED-RISKS.md`.

`API/Services/ICustomerService.cs` includes `Task<List<CustomerResponse>> SearchOdsAsync(string searchTerm, CancellationToken cancellationToken);`.

`CustomerService.SearchOdsAsync` is `SafeListAsync(ct => _repository.SearchOdsAsync(searchTerm, ct), "ODS customer search", cancellationToken)`. `SafeListAsync` maps via `ToResponse()` and degrades to empty on SQL errors.

`API/Models/Responses/CustomerResponse.cs` is a record. Key properties:
- `Id`, `ScoularId`, `Name`, `Location`, `StateProvince`, `AddressLine1`, `PostalCode`, `Phone`, `Email`, `ExtendedPrimaryPhone`, `SupplementalEmail`, `ExtendedAddressLine1..4`, `ExtendedCity`, `ExtendedPostalCode`, `ExtendedStateProvince`, `ExtendedCountry`.
- `bool ESignEnabled`, `bool AchEnabled`, `List<string> ActiveTradeUnits`.
- `string? IndustryCode1`, `string? IndustryCode2`, `string? NopId` (this is the mapped `NopIdNumber`).
- `bool IsActive`, `DateTime? EffectiveStartDate`, `DateTime? EffectiveEndDate`, `bool IsManual`.
- The mapper is `API/Services/Mappings/CustomerMappings.cs: public static CustomerResponse ToResponse(this Customer c)`.

### 2.6 Client
- `CL/core/services/api.service.ts:249-259`:
```ts
searchOdsCustomers(searchTerm: string): Observable<Customer[]> {
  const params = new HttpParams().set('searchTerm', searchTerm);
  return this.http.get<Customer[]>(`${this.baseUrl}/customers/search-ods`, { params }).pipe(catchError(() => of([] as Customer[])));
}
assignTradeUnits(customerId: number, tradeUnitCodes: string[]): Observable<Customer> {
  return this.http.put<Customer>(`${this.baseUrl}/customers/${customerId}/trade-units`, { tradeUnitCodes }).pipe(catchError(e => this.handleError(e))); }
getCustomerTradeUnits(customerId, options: { includeActivity?: boolean } = {})   // GET .../trade-units
removeDormantTradeUnit(customerId, tradeUnit)                                      // DELETE
```
- The component is `CL/features/customers/components/customer-list/customer-list.component.ts:~124-146`.
  - `_searchSubject$` goes through `debounceTime(150)` and `switchMap`.
  - It first calls `apiService.searchCustomers(searchTerm, tradeUnits)`. If there are zero results AND `odsEligible` (no TU or group scope AND `searchTerm.trim().length >= 3`), it calls `searchOdsCustomers(searchTerm)` and maps to `{ ...c, isOnboardCandidate: true }`.
  - The row template (`customer-list.component.html:~138`) shows the "Not added" badge when `customer.isOnboardCandidate`.
  - `edit-customer-dialog.component.ts:154` and `:503` use `isOnboardCandidate` to onboard through `assignTradeUnits`.
- `CL/models/customer.model.ts`: `achEnabled: boolean; // base.Customer.PaymentMethod == 'H'`. Also `industryCode2?: string`, `nopId?: string`, `isOnboardCandidate?: boolean` ("Set client-side, not from the API").
- Badge bindings:
  - ACH: `customer-profile.component.html:43` (`@if (customer().achEnabled)`, blue "ACH Payment" pill, else amber "Check Payment") and `producer-insights.component.html:26`.
  - Filter: `nlq-filter.service.ts:1832` (`c.achEnabled`); spec `nlq-filter.ach.spec.ts`.
  - Organic: `customer-profile.component.ts:532` (`showOrganicBadge = computed(() => isOrganicSectionVisible({ industryCode2, nopId: this.customer()?.nopId ... }))`), using `CL/shared/utils/organic-visibility.ts`. That file has constants `ORGANIC_INDUSTRY_CODE = 'OR'` and `ORGANIC_VISIBILITY_RULES = { industryCode: true, nopId: true }`.
  - The `organic-visibility.ts` comment says the app relies on "every customer the app can see is already a producer by construction" via the view's `IndustryCode1 = 'PR'` filter.

---

## 3. ENTITLEMENTS

### 3.1 `INF/Repositories/EntitlementsRepository.cs` (full read)
```csharp
public class EntitlementsRepository : IEntitlementsRepository
{
    private readonly TradeUnitPreferencesDbContext _entitlementsContext;
    private readonly OriginationDbContext _odsContext;
    public EntitlementsRepository(TradeUnitPreferencesDbContext entitlementsContext, OriginationDbContext odsContext)

    public async Task<List<UserTradeUnitPreference>> GetByUserAsync(string userId, CancellationToken cancellationToken)
    public async Task<List<UserTradeUnitPreference>> GetAllAsync(CancellationToken cancellationToken)
    public async Task<List<UserTradeUnitPreference>> GetUsersByTradeUnitsAsync(IReadOnlyCollection<string> tradeUnitCodes, CancellationToken cancellationToken)
    public async Task<List<string>> GetTradeUnitCodesForUserAsync(string userId, CancellationToken cancellationToken)
    {   // TradeUnitPreferences DB
        return await _entitlementsContext.UserTradeUnitPreferences
            .Where(u => u.UserId == userId).Select(u => u.TradeUnitCode).Distinct().ToListAsync(cancellationToken); }
    public async Task<List<string>> GetCustomerTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken)
    {   // LIVE ODS view
        return (await _odsContext.CustomerTradeUnits
            .Where(c => c.CustomerId == customerId)
            .Select(c => c.TradeUnit)
            .Where(tu => tu != null)
            .Distinct()
            .ToListAsync(cancellationToken))!; }
    public async Task<HashSet<string>> GetActiveUserIdsAsync(IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
}
```
- `IEntitlementsRepository` (`INF/Interfaces/IEntitlementsRepository.cs`) declares the same members. Its doc for the customer method reads "Distinct trade-unit codes a customer belongs to, from the ODS vw_CustomerTradeUnits view — used to validate per-customer access against a user's entitlements."
- This is the only use of `_odsContext` in the repository, so after the change the constructor's `OriginationDbContext` dependency becomes unused. The registration is scoped (`DependencyInjection.cs`).
- `GetCustomerTradeUnitCodesAsync` has NO `IsActive` filter, because the view has none. `dbo.CustomerTradeUnit` has `IsActive`, `IsManual` and `UserDeactivated`, so the semantics need a decision.

### 3.2 `IUserEntitlementService` / `UserEntitlementService` (`API/Services/`)
```csharp
Task<IReadOnlySet<string>> GetAllowedTradeUnitCodesAsync(CancellationToken cancellationToken = default);
bool EntitlementsAvailable { get; }
Task ValidateTradeUnitsOrThrowAsync(IEnumerable<string> tradeUnitCodes, CancellationToken cancellationToken = default);
Task ValidateCustomerAccessAsync(long customerId, CancellationToken cancellationToken = default);
```
- Constructor: `UserEntitlementService(IEntitlementsRepository entitlements, IRequestContextService requestContext, IMemoryCache cache, ILogger<UserEntitlementService> logger)`.
- Caching layers, which cover the USER entitlement set only:
  1. Per request: private field `HashSet<string>? _cachedEntitlements` on the scoped service.
  2. Cross-request `IMemoryCache`, key `$"entitlements:{userId}"`, `CacheTtl = TimeSpan.FromMinutes(10)`, `AbsoluteExpirationRelativeToNow`, `Size = 1` because the cache has a SizeLimit. It is used only as a last-known-good fallback when `GetTradeUnitCodesForUserAsync` throws `SqlException`. If there is no cache it fails closed with an empty set and `EntitlementsAvailable = false`.
- The customer-side lookup in `ValidateCustomerAccessAsync` has NO caching.
- `ValidateCustomerAccessAsync(long customerId, ...)`:
  - Calls `_entitlements.GetCustomerTradeUnitCodesAsync`.
  - If the count is 0, it logs `CUSTOMER_NO_TRADE_UNIT_MAPPING` and throws `ForbiddenException` (fail closed).
  - Otherwise it needs `customerTradeUnits.Any(tu => allowed.Contains(tu))`.
  - `allowed` is built with `StringComparer.OrdinalIgnoreCase`, but the customer's TU codes are not trimmed here.
- **Every caller of `GetCustomerTradeUnitCodesAsync`: only `UserEntitlementService.ValidateCustomerAccessAsync` (`UserEntitlementService.cs:145`).** `ValidateCustomerAccessAsync` has NO request-path caller in `API/`. The XML doc is explicit: "DELIBERATELY NOT CALLED ON ANY REQUEST PATH ... accepted risk AR-02 ... Kept — with tests". `ProducerDetailsService.cs:97` mentions it in a comment only.
- Tests that mock it, all in `TEST/Services/UserEntitlementServiceTests.cs:226-264`: `ValidateCustomerAccessAsync_WhenCustomerHasNoTradeUnitMapping_ThrowsForbidden`, `..._WhenCallerSharesNoTradeUnitWithCustomer_ThrowsForbidden`, `..._WhenCallerSharesOneTradeUnit_DoesNotThrow`. They use `Setup(e => e.GetCustomerTradeUnitCodesAsync(123L, It.IsAny<CancellationToken>()))`.
- If the access check is wired up later, AR-02 must be updated in the same change. It "fails CLOSED when a customer has no trade-unit mapping", which would deny not-yet-synced customers.

### 3.3 How `dbo.CustomerTradeUnit` is read elsewhere
All of these filter `IsActive`. This is the "snapshot" the app uses for scoping.
- `INF/Repositories/CustomerRepository.cs`: `GetAsync` (l.~59, `ctu.IsActive && tradeUnits.Contains(ctu.TradeUnit)`), `SearchAsync` (raw SQL `EXISTS ... ctu.IsActive = 1 AND ctu.TradeUnit IN (STRING_SPLIT)`), `EnrichCustomersWithTradeUnitsAsync`, `GetActiveCustomerIdsInTradeUnitsAsync`, `GetFirstActiveTradeUnitAsync`, `GetActiveTradeUnitCodesAsync`, `GetAllActiveTradeUnitCodesAsync` (distinct, ordered).
- `GetTradeUnitMembershipsAsync` returns active AND inactive rows, with `IsManual` and `IsActive`, for the edit dialog.
- `INF/Repositories/ContractRepository.cs:78,219`, `TicketRepository.cs:65`, `DpContractRepository.cs:168`, `StoredGrainRepository.cs:99`, `PlantingIntentionRepository.cs:42`, `NoteRepository.cs:88`: `_appContext.CustomerTradeUnits.Any(ctu => ctu.CustomerId == ... && ctu.IsActive && ...)`.
- CTRM paths build the producer set from the snapshot (these are the circular dependency for the TU derivation):
  - `INF/Ctrm/CtrmContractRepository.cs:~441` `ResolveScopedProducerCodesAsync(List<string>? tradeUnits, ct)`:
```csharp
_appContext.Customers.AsNoTracking().Where(c => c.IsActive && c.ScoularId != null
    && _appContext.CustomerTradeUnits.Any(ctu => ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits.Contains(ctu.TradeUnit)))
```
  - `CtrmTicketRepository.cs:~357` `ResolveTradeUnitProducerCodesAsync` uses the same shape.
  - Both return nothing when `tradeUnits` is empty ("DIFFERS FROM ODS ON PURPOSE").
- `API/Services/NoteService.cs:104`: "Derive TradeUnit from the authoritative dbo.CustomerTradeUnit".
- `API/Services/ProducerDetailsService.cs:~92,194`: membership test against `CustomerTradeUnit` (active rows only).
- `API/Services/TradeUnitService.cs:41` and `UserTradeUnitService.cs:100` fall back to the active `CustomerTradeUnit` codes when the TradeUnitPreferences DB is unavailable.
- `UserTradeUnitSnapshot` (`INF/Data/Entities/UserTradeUnitSnapshot.cs`) is a per-USER usage-dashboard snapshot: `UserId, DisplayName, TradeUnitCode, GroupName, SnapshotDate`. It is not customer-related.
- IsActive semantics: sync sets true on insert/reactivate, false when the pair drops out of the ODS view (except `IsManual`). `UserDeactivated` is set by `DeactivateDormantTradeUnitAsync` (`IsActive = false; UserDeactivated = true; ModifiedBy = user`). `IsManual` rows come from `AssignTradeUnitsAsync`.

---

## 4. CTRM / GRAPHQL CLIENT PATTERN TO MIRROR

### 4.1 Client contract (`INF/Ctrm/ICtrmGraphQlClient.cs`)
```csharp
public interface ICtrmGraphQlClient
{
    bool IsConfigured { get; }
    Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken);
}
public enum CtrmReadStatus { Ok, PartialSuccess, NotConfigured, Warming, TokenFailure, EgressBlocked, Unauthorized, Throttled, QueryError, Error }
public sealed record CtrmReadResult<T> {
    public CtrmReadStatus Status { get; init; }
    public bool Ok => Status is CtrmReadStatus.Ok or CtrmReadStatus.PartialSuccess;
    public int? HttpStatus { get; init; }  public string? Detail { get; init; }
    public string? ErrorCode { get; init; }  public T? Value { get; init; }  public string? Origin { get; init; } }
public static class CtrmReadOrigin { public const string TradeUnitCache = "tradeUnitCache"; }
```
- `Status` doc: PartialSuccess = response had BOTH `data` and `errors`; it is treated as usable (`Ok` is true) but logged.
- Documents must contain NO `#` comment lines (the WAF returns an HTML 403).
- `CtrmReadFailure.IsFailure(status)` is true for `NotConfigured, TokenFailure, EgressBlocked, Unauthorized, Throttled, QueryError, Error, Warming`.

### 4.2 Implementation (`API/Services/Ctrm/CtrmGraphQlClient.cs`, `public sealed class CtrmGraphQlClient : ICtrmGraphQlClient`)
- Constructor: `CtrmGraphQlClient(TokenCredential? credential, IHttpClientFactory httpFactory, IConfiguration configuration, ILogger<CtrmGraphQlClient> logger)`.
- `HttpClientName = "ctrm"`. `IsConfigured = uri && audience && credential not null`, read once from `Ctrm:GraphQlUri` and `Ctrm:Audience` at construction.
- Token:
  - `GetBearerTokenAsync` caches the `AccessToken` and refreshes when `ExpiresOn <= UtcNow + 5 min`. A `SemaphoreSlim _tokenLock` is held during the refresh.
  - Scopes are `[audience]`. It calls `_credential!.GetTokenAsync(new TokenRequestContext(_scopes), ct)`.
  - It catches `CredentialUnavailableException or AuthenticationFailedException`, logs `INFRASTRUCTURE_CTRM_TOKEN`, and returns `TokenFailure`. The token is acquired in the service, not a `DelegatingHandler`.
- POST: `JsonSerializer.Serialize(new { query = document, variables })` as a `StringContent` with `application/json`, sent with `HttpMethod.Post, string.Empty` to the client BaseAddress. `Authorization: Bearer`.
- Response classification:
  - 401/403 with a non-HTML body gives `Unauthorized`; 429 gives `Throttled`.
  - `BrokenCircuitException`, `HttpRequestException`, `TimeoutRejectedException` and `TaskCanceledException` (when not caller-cancelled) all give `EgressBlocked`.
  - An HTML body (first char `<`) gives `Error`, "WAF rejected".
  - The body is parsed even for non-2xx statuses (HTTP 500 can carry validation errors).
  - `errors[]` with `data` gives `PartialSuccess`; `errors[]` without data gives `QueryError`, carrying `extensions.code`.
  - Neither `data` nor `errors` gives `Error`.
  - It reads `x-correlation-id` into `Detail`.
- JSON options: `PropertyNameCaseInsensitive = true`, plus `CtrmNullableDateTimeConverter` and `CtrmDateTimeConverter` for CTRM's space-separated timestamps.
- Logging tags: `INFRASTRUCTURE_CTRM_UNAVAILABLE`, `INFRASTRUCTURE_CTRM_PARTIAL`, `INFRASTRUCTURE_CTRM_SHAPE`.

### 4.3 Registration (`API/Program.cs`)
- Lines 365-382, singleton with a lambda:
```csharp
builder.Services.AddSingleton<GrainOriginatorPortal.Infrastructure.Ctrm.ICtrmGraphQlClient>(sp => {
    var tenantId = config.GetValue<string>("Ctrm:TenantId")?.Trim(); clientId = "Ctrm:ClientId"; clientSecret = "Ctrm:ClientSecret";
    Azure.Core.TokenCredential? ctrmCredential = (all three non-empty) ? new ClientSecretCredential(tenantId, clientId, clientSecret) : null;
    return new CtrmGraphQlClient(ctrmCredential, sp.GetRequiredService<IHttpClientFactory>(), config, sp.GetRequiredService<ILogger<CtrmGraphQlClient>>()); });
```
- The credential and client are built ONCE at startup, so the secret must exist in Key Vault before the restart.
- Key Vault: `builder.Configuration.AddAzureKeyVault(new Uri(keyVaultUri), kvCredential)` at `Program.cs:53`. It uses `ManagedIdentityCredential(SystemAssigned)` on App Service.
- Secret `Ctrm--ClientSecret` maps to `Ctrm:ClientSecret`. It is in `kv-orig-eus`, `kv-orig-qa-eus` and `kv-orig-dev-eus`. Never in appsettings. `ClientSecret` comments are in the base file and the Dev/QA/Prod files.
- A `customers` query needs a separate permission (`Customers.Read.All` or `ReadCustomersBasic`), which our clients do not hold yet. The Dev/QA nonprod identity is `5e9cb280-...` and the PROD identity is `25ce2e75-...`.
- HTTP client (`Program.cs:487-540`):
```csharp
AddHttpClient("ctrm", client => { BaseAddress = new Uri(Ctrm:GraphQlUri); client.Timeout = TimeSpan.FromSeconds(150); })
 .AddHttpMessageHandler<CorrelationIdOutboundHandler>()
 .AddResilienceHandler("ctrm", pipeline => {
   AddRetry(MaxRetryAttempts=2, Delay=500ms, Exponential, jitter, MaxDelay=10s, ShouldHandle = HttpRequestException || TaskCanceledException ONLY — never status codes);
   AddCircuitBreaker(FailureRatio=0.5, SamplingDuration=30s, MinimumThroughput=5, BreakDuration=30s);
   AddTimeout(45s) /* per attempt, innermost */ });
```

### 4.4 `CtrmServerTimeoutRetry` (`INF/Ctrm/CtrmServerTimeoutRetry.cs`)
```csharp
public const string ServerTimeoutCode = "HC0045";
public static async Task<CtrmReadResult<T>> RunAsync<T>(Func<Task<CtrmReadResult<T>>> attempt, IConfiguration configuration, ILogger logger, string what, bool interactive = false)
public static bool IsServerTimeout<T>(CtrmReadResult<T> result)
```
- It retries only on `ErrorCode == "HC0045"`.
- Keys: `Ctrm:ServerTimeoutRetries` (clamp 0-10, default 0), `Ctrm:ServerTimeoutRetryDelaySeconds` (clamp 0-120, default 8), `Ctrm:InteractiveServerTimeoutRetries` (clamp 0-4, default 0), `Ctrm:InteractiveServerTimeoutRetryDelaySeconds` (clamp 0-30, default 3).

### 4.5 `CtrmConfig` (`INF/Ctrm/CtrmConfig.cs`)
```csharp
public static int ReadInt(IConfiguration configuration, string key, int fallback)   // int.TryParse(configuration[key]?.Trim(), NumberStyles.Integer, InvariantCulture)
public static bool ReadBool(IConfiguration configuration, string key, bool fallback)
```
- Knobs are read fresh at point of use, not bound at startup.
- It uses the `IConfiguration` indexer because `GetValue<T>` lives in the Binder package, which `INF` does not reference.

### 4.6 Switch pattern (per-call config read)
`INF/Ctrm/ContractRepositorySwitch.cs`:
```csharp
public sealed class ContractRepositorySwitch : IContractRepository {
  public const string CtrmSourceValue = "ctrm";
  public ContractRepositorySwitch(ContractRepository ods, CtrmContractRepository ctrm, IConfiguration configuration, CtrmProvenance provenance)
  public bool UsingCtrm => string.Equals(_configuration["Ctrm:Source"]?.Trim(), CtrmSourceValue, StringComparison.OrdinalIgnoreCase);
  private IContractRepository Active { get { var useCtrm = UsingCtrm; _provenance.RecordSource(useCtrm ? CtrmSourceValue : "ods"); return useCtrm ? _ctrm : _ods; } }
  // every method: => Active.Method(...)
}
```
- `TicketRepositorySwitch` is the same, reusing `ContractRepositorySwitch.CtrmSourceValue`.
- Anything other than literal `ctrm` means ODS. An empty, absent or misspelled value stays on ODS.
- A new `CustomerSync:Source` switch should read `_configuration["CustomerSync:Source"]` the same way.
- `CtrmKeepWarmService.ShouldWarmNow(...)` also reads `Ctrm:Source` per tick: `string.Equals(configuredSource?.Trim(), "ctrm", OrdinalIgnoreCase)`.

### 4.7 DI (`INF/DependencyInjection.cs`)
```csharp
services.AddSingleton<CtrmContractReader>();  services.AddSingleton<CtrmTicketReader>();  services.AddSingleton<CtrmWarmRegistry>();
services.AddScoped<CtrmProvenance>();
services.AddScoped<TicketRepository>(); services.AddScoped<CtrmTicketRepository>(); services.AddScoped<ITicketRepository, TicketRepositorySwitch>();
services.AddScoped<ContractRepository>(); services.AddScoped<CtrmContractRepository>(); services.AddScoped<IContractRepository, ContractRepositorySwitch>();
services.AddScoped<ICustomerRepository, CustomerRepository>(); services.AddScoped<IEntitlementsRepository, EntitlementsRepository>(); services.AddScoped<ICustomerSyncRepository, CustomerSyncRepository>();
```
- `ICtrmGraphQlClient` is registered in `API/Program.cs`, not in `INF`. `CtrmKeepWarmService` is `AddHostedService` at `Program.cs:152`.
- `CtrmTradeUnitThrottle` is a static class with static semaphores (`Slots`, `BatchSlots`), not DI.

### 4.8 `CtrmContractReader` (`INF/Ctrm/CtrmContractReader.cs`, singleton)
```csharp
public CtrmContractReader(ICtrmGraphQlClient client, IConfiguration configuration, ILogger<CtrmContractReader> logger, Func<DateTime>? utcNow = null)
public Task<CtrmReadResult<List<CtrmContractDto>>> GetForProducerFullAsync(string scoularId, CancellationToken cancellationToken)   // with pricing lines
public Task<CtrmReadResult<List<CtrmContractDto>>> GetForProducerCoreAsync(string scoularId, CancellationToken cancellationToken)   // no prices
public Task<CtrmReadResult<List<CtrmContractDto>>> GetForProducersAsync(IReadOnlyCollection<string> scoularIds, CancellationToken cancellationToken)  // full history for a producer set
public bool IsWarm(IReadOnlyCollection<string> scoularIds); public IReadOnlyList<string> Describe(string scoularId); public void Invalidate(string scoularId)
public const string PerProducerStrategy = "perProducer"; CustomerIdsStrategy = "customerIds"; AliasedStrategy = "aliased";
private const int PageSize = 500; MaxPages = 20; MaxCustomerIdsPerCall = 500; DefaultMaxPagesPerChunk = 100; SweepEvery = 64;
```
- Paging: `skip += PageSize` loop to `MaxPages`; `PageInfo.HasNextPage` is authoritative. Hitting the cap logs `TRUNCATED` (`INFRASTRUCTURE_CTRM_TRUNCATED`) and returns `PartialSuccess`.
- `customerIds` path (`FetchByCustomerIdsAsync`):
  - Codes are normalised with `CtrmCustomerCodes.Normalize` (drop longer than 7) and chunked by 500.
  - First pages are fetched for every chunk (concurrency `Ctrm:TradeUnitContractConcurrency`, clamp 1-8, default 2) to learn `totalCount`. Remaining pages are then fetched, capped by `Ctrm:TradeUnitContractMaxPagesPerChunk`.
  - The key is `$"producers:{codes.Count}:{StableHash(codes)}"`. The TTL is `Ctrm:TradeUnitCacheMinutes` with stale-while-revalidate.
- Aliased strategy (`FetchAliasedAsync`):
  - `Ctrm:TradeUnitAliasCount` (clamp 1-25, default 5) times `Ctrm:TradeUnitAliasCodesPerAlias` (clamp 1-2, default 2) gives codes per request. It uses `codes.Chunk(aliasCount*codesPerAlias)`.
  - Concurrency is `Ctrm:TradeUnitContractBatchConcurrency` (clamp 1-32, default 8), through `CtrmTradeUnitThrottle.RunContractBatchAsync`.
  - Each batch result is `Dictionary<string, CtrmPage<CtrmContractDto>>`, keyed `a{i}`.
  - Retry: a failed batch gets one retry at 1 code per alias after 2 s, sent without the HC0045 retry. A second failure sets `doomed`, and unsent batches are skipped (load shedding).
  - A `PartialSuccess` status is treated as a failure for aliased batches. An alias with `HasNextPage` is topped up through `FetchProducerCoreAsync`.
  - The whole read fails rather than returning a short list.
- Cache:
  - `ConcurrentDictionary<string, CacheEntry>` (case-insensitive). A `CacheEntry` holds a `Lazy<Task<...>>`, so a losing racer never fires HTTP. `BestAvailable` returns the previous completed task during a refresh.
  - A failed entry is never kept. The live TTL is `Ctrm:LiveCacheSeconds` (default 60). The sweep grace is the TU cache minutes.
  - Keys: per-producer `customer:{code}:full` and `customer:{code}:core`; sets `producers:{n}:{hash}`.
  - `_setsByProducer` lets a click be served from a warm set (`TryServeFromProducerSet`), controlled by `Ctrm:ServeClickFromTradeUnitCache`.
- Interactive reads: `CtrmTradeUnitThrottle.Interactive()` is a scope, and background work defers to it for up to `Ctrm:BackgroundMaxDeferSeconds` (clamp 0-300, default 20). Background slots: `Ctrm:TradeUnitMaxConcurrentRequests` (clamp 1-16, default 6).

### 4.9 `CtrmTicketReader` (`INF/Ctrm/CtrmTicketReader.cs`, singleton)
```csharp
public CtrmTicketReader(ICtrmGraphQlClient client, IConfiguration configuration, ILogger<CtrmTicketReader> logger, ...)
public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducerAsync(string scoularId, CancellationToken cancellationToken)
public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForContractsAsync(IReadOnlyCollection<string> contractNumbers, CancellationToken cancellationToken)
public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducersAsync(IReadOnlyCollection<string> scoularIds, DateTime from, DateTime to, CancellationToken cancellationToken)   // ONE window, <=366d, chunked by 500 codes
public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducersHistoryAsync(IReadOnlyCollection<string> scoularIds, CancellationToken cancellationToken)   // 3y lookback in windows
public static List<(DateTime From, DateTime To)> BuildWindows(DateTime today, int lookbackDays)
public static List<(DateTime From, DateTime To)> Subdivide(List<(DateTime From, DateTime To)> windows, int parts)
```
- `BuildWindows`:
  - It starts from `to = today.AddDays(1)` and `earliest = today.AddDays(-lookbackDays)`. It steps back `MaxTicketRangeDays` (366) per window, newest first.
  - Windows are inclusive on both ends: `to = from.AddDays(-1)` for the next window.
  - `Ctrm:TicketLookbackDays` defaults to 1095 (three years).
- A window longer than 366 days returns `Failed(...)` (server-enforced, `VALIDATION`).
- TTLs: `LiveTtl()` is `Ctrm:LiveCacheSeconds`. Past windows use `Ctrm:HistoricalTicketCacheMinutes` (30). The TU current window uses `Ctrm:TradeUnitCurrentWindowCacheMinutes` (5).
- Max pages per TU window: `Ctrm:TradeUnitTicketMaxPagesPerWindow` (200). Interactive concurrency: `Ctrm:InteractivePageConcurrency` (4).

### 4.10 Customer-code helpers
- `INF/Ctrm/CtrmCustomerCodes.cs`:
```csharp
public const int MaxLength = 7;     // 8-char code => "An internal error occurred" for the WHOLE customerIds request
public const int MaxPerCall = 500;
public static List<string> Normalize(IReadOnlyCollection<string>? codes, out List<string> dropped)   // trim, distinct (OrdinalIgnoreCase), sorted, drops >7
public static List<string> NormalizeKeepingAll(IReadOnlyCollection<string>? codes)
```
- `INF/Ctrm/CtrmProducerCode.cs`: `ResolveAsync(ApplicationDbContext appContext, ILogger logger, string what, long customerId, string? scoularId, CancellationToken ct)` maps `dbo.Customer.Id` to `ScoularId`.
- `INF/Ctrm/CtrmSyntheticId.cs`:
```csharp
public const long ReservedBase = 7_000_000_000_000_000;  public const long Span = 2_000_000_000_000_000;
public static bool IsSynthetic(long id) => id >= ReservedBase && id < ReservedBase + Span;
public static long From(params string?[] keyParts)   // FNV-1a 64 over joined (U+001F) parts mod Span + ReservedBase
```
  - It is capped below 2^53 for JS safety.
  - Used for `Contract.Id` (`From(d.ContractId)`) and `Ticket.Id` (`From(prefix, number, suffix, blDate yyyy-MM-dd, productCode, detailSeq)`).
  - The band is 7e15 to 9e15. A customer id minted from it would collide semantically with contract and ticket ids. Customer ids are not currently mixed with them on a screen.

### 4.11 Provenance (`INF/Ctrm/CtrmProvenance.cs`, scoped)
```csharp
public const string SourceHeader = "X-Data-Source"; ContractsHeader = "X-Data-Source-Contracts"; TicketsHeader = "X-Data-Source-Tickets";
public void RecordSource(string source); RecordContracts(string source, string outcome, int rows); RecordTickets(...); RecordFailure(string what, CtrmReadStatus status, string? detail); RecordPartial();
public string? Source, Contracts, Tickets; public CtrmReadFailure? Failure; public bool Partial; long? ContractsMs, TicketsMs;
```
- Emitted by `CtrmProvenanceMiddleware` (`Program.cs:753`).
- `CtrmReadFailure(string What, CtrmReadStatus Status, string? Detail)`.

### 4.12 DTOs and mappings
- `INF/Ctrm/Dtos/CtrmContractDtos.cs`:
```csharp
public sealed class CtrmPage<T> { int TotalCount; CtrmPageInfo? PageInfo; List<T> Items }
public sealed class CtrmPageInfo { int Skip; int Take; bool HasNextPage; bool HasPreviousPage }
public sealed class CtrmContractsResponse { CtrmPage<CtrmContractDto>? Contracts }
// CtrmContractDto.CustomerId: "The Scoular customer code. Byte-identical to ODS CustomerCode / Contract.CtrmCustomerId / Customer.ScoularId — one namespace, verified on TATOBIN."
```
  Fields: `ContractId, ContractPrefixType, ContractNumber, CustomerId, TradeUnit, CommodityCode, CommodityDescription, CommodityGroup, ContractDate, StartShipDate, FinalShipDate, ClosedDate, CropYear, Quantity, QuantityUom, TotalValue, PricedQuantity, OpenBalanceQuantity, SettledQuantity, PriceTypeCode, SpecialType, CustomerConfirmStatus, MarketZone, BasisLocation, HedgeMarketMonthDescription, PriceMarketMonthDescription, Prices`.
- `CtrmTicketDtos.cs`: `CtrmTicketsResponse { CtrmPage<CtrmTicketDto>? Tickets }`; `CtrmTicketDto { TicketPrefix, TicketNumber, TicketSuffix, TicketBLDate, ProductCode, ShipmentTicketNumber, UnloadQuantity, Details }`; `CtrmTicketDetailDto { TicketSequenceNumber, CustomerCode, OrganizationCode, ElevatorCode, GradeCode, ContractNumber, TicketType, TicketStatusDescription, AppliedNetQuantity, FinalSettledDate, GradeFactorMoisturePercent, GradeFactorTestWeightPercent, GradeFactorProteinPercent, CancelFlag }`.
- `CtrmMappings` (`INF/Ctrm/CtrmMappings.cs`):
  - Constants: `PurchasePrefix = "P"`, `CancelledFlag = "Y"`.
  - Contract mapping: `ToContracts(IEnumerable<CtrmContractDto>, DateTime today)` keeps only non-blank `ContractId` and `ContractPrefixType == "P"` (case-insensitive).
  - `ToContract`: `Id = CtrmSyntheticId.From(d.ContractId)`, `CustomerId = null`, `CtrmCustomerId = Clean(d.CustomerId)`, `SourceContractId = Clean(d.ContractId)`, `TradeUnit = Clean(d.TradeUnit)`, `ClosedDate = NullIfSentinel(d.ClosedDate)`, `IsActive = true`, `IsDeleted = false`.
  - Sentinel: `NullIfSentinel(DateTime? value) => value is null || value.Value.Date <= OdsConstants.OpenClosedDateSentinel ? null : value;` ('0001-01-01' means open). Then `ContractStatusCalculator.NormalizeOpenClosedDates(contracts)` and `Calculate`.
  - Ticket mapping: `private static List<Ticket> ToTickets(CtrmTicketDto header, Func<CtrmTicketDetailDto, bool> keep)` filters `!CancelFlag == "Y"` and `IsOdsEligible`. `IsOdsEligible` requires `TicketType` in `["U","P"]` and `TicketStatusDescription` not equal to "Consolidated".
  - Per-ticket mapping: `CustomerCode = Clean(d.CustomerCode)`, `OrganizationCode = Clean(d.OrganizationCode)`, `CtrmContractNumber = Clean(d.ContractNumber)`, `Date = blDate?.ToString("yyyy-MM-dd")`.
  - Entry points: `ToTickets(header, scoularId)`, `ToUnappliedForProducer(header, scoularId)`, `ToUnappliedForProducers(header, ISet<string>)`, `ToAppliedForContracts`, `ToTicketsForContract`.
  - Unapplied means the contract number prefix is in `U/L/C`.

### 4.13 GraphQL documents currently used (verbatim from `INF/Ctrm/CtrmQueries.cs`)
```graphql
# ContractsProbe
query ($from: Date!, $to: Date!) {
  contracts(skip: 0, take: 1, contractDateFrom: $from, contractDateTo: $to) {
    totalCount
    items { contractId customerId contractDate }
  }
}

# ContractCoreProjection (fields; no "#" lines in real documents)
contractId contractPrefixType contractNumber
customerId tradeUnit
commodityCode commodityDescription commodityGroup
contractDate startShipDate finalShipDate closedDate cropYear
quantity quantityUom totalValue
pricedQuantity openBalanceQuantity settledQuantity
priceTypeCode specialType customerConfirmStatus
marketZone basisLocation
hedgeMarketMonthDescription priceMarketMonthDescription
# ContractProjection = ContractCoreProjection + prices { priceSequence priceQuantity flatPrice basisPrice hedgePrice freightAdjustment priceDate customerConfirmStatus }

# ContractsByCustomer (full projection; variables customerId, prefix, skip, take)
query ($customerId: String, $prefix: String, $skip: Int, $take: Int) {
  contracts(skip: $skip, take: $take, customerId: $customerId, contractPrefixType: $prefix) {
    totalCount
    pageInfo { skip take hasNextPage hasPreviousPage }
    items { <ContractProjection> }
  }
}
# ContractsByCustomerCore: identical but items { <ContractCoreProjection> }

# ContractsByCustomers
query ($customerIds: [String!], $prefix: String, $skip: Int, $take: Int) {
  contracts(skip: $skip, take: $take, customerIds: $customerIds, contractPrefixType: $prefix) {
    totalCount
    pageInfo { skip take hasNextPage hasPreviousPage }
    items { <ContractCoreProjection> }
  }
}

# ContractsByCustomersAliased(groups, take, prefix) builds (inline, JSON-serialised codes):
query {
  a0: contracts(skip: 0, take: 500, customerIds: ["A","B"], contractPrefixType: "P") {
    pageInfo { hasNextPage }
    items { <ContractCoreProjection> }
  }
  a1: contracts(skip: 0, take: 500, customerId: "C", contractPrefixType: "P") { ... }
}

# TicketProjection (shared)
ticketPrefix ticketNumber ticketSuffix ticketBLDate productCode
shipmentTicketNumber unloadQuantity
details {
  ticketSequenceNumber
  customerCode organizationCode elevatorCode gradeCode
  contractNumber ticketType ticketStatusDescription
  appliedNetQuantity finalSettledDate
  gradeFactorMoisturePercent gradeFactorTestWeightPercent gradeFactorProteinPercent
  cancelFlag
}

# TicketsByCustomer
query ($customerId: String, $from: Date, $to: Date, $skip: Int, $take: Int) {
  tickets(skip: $skip, take: $take, blDateFrom: $from, blDateTo: $to, customerId: $customerId,
          excludeCancelled: true, excludeConsolidated: true) {
    totalCount
    pageInfo { skip take hasNextPage hasPreviousPage }
    items { <TicketProjection> }
  }
}
# TicketsByContractNumbers: variables ($contractNumbers: [String!], $from, $to, $skip, $take); args contractNumbers: $contractNumbers + same excludes
# TicketsByCustomers: variables ($customerIds: [String!], $from: Date, $to: Date, $skip, $take); args customerIds: $customerIds + same excludes
# BuildTicketBatch(keys): aliased t{i}: ticket(ticketPrefix:$p{i}, ticketNumber:$n{i}, ticketSuffix:$s{i}, ticketBLDate:$b{i}, productCode:$c{i}) { <projection> } with variables p{i}/n{i}/s{i}/b{i}/c{i}
```
- `public const int MaxTicketRangeDays = 366;`.
- `Dtos/` classes use case-insensitive deserialisation of `data` into `CtrmContractsResponse` and `CtrmTicketsResponse`. Each is a root-field-named wrapper (`contracts` or `tickets`). A customers wrapper would follow `public sealed class CtrmCustomersResponse { public CtrmPage<CtrmCustomerDto>? Customers { get; set; } }`.
- Diagnostics probe at `DiagnosticsController.cs:~165` uses an inline `contracts(skip: 0, take: 1, contractDateFrom: $from, contractDateTo: $to) { totalCount items { contractId contractPrefixType customerId contractDate priceTypeCode } }`.
- Introspection is rejected by the gateway with `HC0046`.

### 4.14 `appsettings.json` `Ctrm` section: every non-comment key and base value
```
Source ""  GraphQlUri ""  TenantId ""  ClientId ""  Audience ""  (ClientSecret: NEVER here; Key Vault Ctrm--ClientSecret)
PageSize 500  PageConcurrency 4  TradeUnitContractStrategy "aliased"  TradeUnitAliasCount 5
TradeUnitContractBatchConcurrency 8  TradeUnitAliasCodesPerAlias 2  TradeUnitPerProducerConcurrency 8
TradeUnitCacheMinutes 15  TradeUnitContractConcurrency 2  TradeUnitMaxConcurrentRequests 6  BackgroundMaxDeferSeconds 20
ServerTimeoutRetries 1  ServerTimeoutRetryDelaySeconds 90  InteractiveServerTimeoutRetries 0  InteractiveServerTimeoutRetryDelaySeconds 3
InteractivePageConcurrency 4  InteractiveWindowSplit 1  TradeUnitContractMaxPagesPerChunk 100  TradeUnitTicketMaxPagesPerWindow 200
LiveCacheSeconds 60  TicketLookbackDays 1095  CrossBookedAppliedTickets false  HistoricalTicketCacheMinutes 30
TradeUnitCurrentWindowCacheMinutes 5  ServeClickFromTradeUnitCache true  ServeClickFromTradeUnitCacheMaxMinutes 15
KeepWarmMinutes 5  KeepWarmForHours 2  KeepWarmFailureBackoffMinutes 15  RecentTicketDays 30
```
- JSON comment convention: keys prefixed `"// KeyName"` hold prose explanations. Every key has a `"// ..."` sibling.
- Overrides:
  - `appsettings.Dev.json`, `.QA.json`, `.Development.json`: `Source "ctrm"`, `GraphQlUri "https://apiqa.scoular.com/internal/graphql"`, `TenantId "1521f999-f722-4a4f-9747-166f93e9b0d1"`, `ClientId "5e9cb280-b006-4705-9ecf-4bbf9d1c7085"`, `Audience "api://243ea5dc-2187-44aa-aa62-3d303608be53/.default"`, `TradeUnitContractBatchConcurrency 4`. Dev and QA have a `// ClientSecret` comment only.
  - `appsettings.Production.json`: `Source "ctrm"`, `GraphQlUri "https://api.scoular.com/internal/graphql"`, same `TenantId`, `ClientId "25ce2e75-76b6-4fb9-a6bf-ed76ef11adae"`, same `Audience`. The batch concurrency is not overridden, so it stays 8. A rate-limit note says 3,000 calls per 60 s for this identity.
  - Rollback: App Service setting `Ctrm__Source = ods`.
- `Ctrm:Source` doc (base): "EMPTY here ON PURPOSE so no environment can accidentally leave ODS". A new `CustomerSync:Source` has no existing keys. The base file `CustomerSync` section holds only `RunAtTimeUtc`.

---

## 5. GRAPHQL SCHEMA FACTS (as supplied; do NOT take these as verified by the repo)
The repo contains no `customers` query, no customer DTOs, and no mention of `Customers.Read.All` or `ReadCustomersBasic` (grep over `docs` and `api`). Everything below comes from the task statement.
- Root `customers(skip, take, sourceCode, sourceSystem, code, codes:[String!], sourceCodes:[String!] "probably exists, verify", nameContains)`. `take` is capped at 500.
- Customer fields TODAY: `id, code, name, sourceCode, sourceSystem, activeYN ('Y'/'N'), merchandisingName, merchandisingAddressLine1, merchandisingAddressLine2, merchandisingCity, merchandisingStateProvince, merchandisingPostalCode, merchandisingCountry, merchandisingPhone, industryCode1, industryCode2, industryCode3, mdmMatchStatus, mdmMasterRecord, workflowStatus, lastChangedUtc, intercompany, contracts (child)`.
- Requested but NOT yet available:
  - Fields: `merchandisingEmail, extendedPrimaryPhone, supplementalEmail, extendedAddressLine1-4, extendedCity, extendedStateProvince, extendedPostalCode, extendedCountry, nopidNo, paymentMethod, duplicateYN`.
  - Filters: `industryCode1`, last-changed-since.
  - Query: customer to tradeUnit pairs.
- An unknown field name returns HTTP 400 for the whole query. Validation errors return HTTP 200 with `errors[].extensions.code = "VALIDATION"`.
- The client treats HTTP 400 like any non-401/403/429 status. The body is parsed, and `errors[]` without data gives `QueryError`. HC0045 arrives as HTTP 400.
- About 302,576 Profisee customers in total. `customers` needs a separate permission (`Customers.Read.All` or `ReadCustomersBasic`) that our clients lack.
- Contract fields (confirmed in repo): `customerId` (== ScoularId, "one namespace"), `tradeUnit`, `contractPrefixType`, `closedDate`. The `tradeUnitName` field is not in the repo's projection.
- Tickets root needs `blDateFrom`/`blDateTo` (<= 366 days). `TicketDetail` carries `customerCode`, `organizationCode`, `contractNumber`.
- Repo-verified facts:
  - The `customerIds` list is capped at 500 and tolerates codes of 7 characters or fewer.
  - `customerIds` on `contracts` waives the date range, but cold chunks are about 25 s.
  - The singular `customerId` is indexed (1-2 s).
  - The API caches list results and the cache key omits `cropYear` and `tradeUnit` (do not filter on those). The key DOES include `customerId`, `customerIds`, `contractNumbers`, `contractPrefixType`, dates, `skip/take` and the exclude flags.
  - The server timeout is 30 s (HC0045); a re-send after the cold plan compile is served from cache.

---

## 6. ODS VIEW SEMANTICS: `API/Scripts/AddIndustryCode2AndNopIdToCustomerTradeUnitsView.sql` (full)
```sql
-- Add IndustryCode2 (the organic 'OR' code) and NopIdNumber to
-- originations.vw_CustomerTradeUnits so the customer sync can carry them onto dbo.Customer.
--
-- Both columns already exist on base.Customer as nvarchar(100) NULL; this only projects them.
-- Additive and safe: they are per-customer attributes, so they cannot change the row count of
-- either SELECT DISTINCT block or their UNION.
--
-- RUN ORDER: this view change must land in an environment BEFORE the application code that
-- declares the columns is deployed there. CustomerTradeUnitView is mapped with ToView, so EF
-- selects every declared property by name and a missing column fails the whole query -- which
-- stops the nightly customer sync. Dev applied 2026-09-21; QA and PROD still owed.
--
-- NOTE: NopIdNumber holds the literal '0' as a placeholder on ~1,525 rows. The sync normalises
-- that to NULL on the way in (CustomerSyncService.ApplyAttributes); do not treat '0' as a NOPID.

ALTER VIEW [originations].[vw_CustomerTradeUnits]
AS
-- Customers linked via active contracts
SELECT DISTINCT
    c.CustomerId,
    c.CustomerName,
    c.SourceCustomerId,
    c.MerchandisingPhone,
    c.MerchandisingEmail,
    c.ExtendedPrimaryPhone,
    c.SupplementalEmail,
    c.MerchandisingCity,
    c.MerchandisingStateProvince,
    c.MerchandisingAddressLine1,
    c.MerchandisingPostalCode,
    c.ExtendedAddressLine1,
    c.ExtendedAddressLine2,
    c.ExtendedAddressLine3,
    c.ExtendedAddressLine4,
    c.ExtendedCity,
    c.ExtendedStateProvince,
    c.ExtendedPostalCode,
    c.ExtendedCountry,
    c.IndustryCode1,
    c.IndustryCode2,
    c.NopIdNumber,
    c.IsActive,
    c.EffectiveStartDate,
    c.EffectiveEndDate,
    con.TradeUnit
FROM base.Customer c
INNER JOIN base.Contract con ON con.CtrmCustomerId = c.SourceCustomerId
WHERE c.IsActive    = 1
  AND c.IndustryCode1 = 'PR'
  AND c.CustomerName NOT LIKE '%DUP%'
  AND c.CustomerName NOT LIKE '%DO NOT USE%'
  AND LEFT(c.CustomerName, 1) NOT IN ('*', '$')
  AND con.IsActive  = 1
  AND con.TradeUnit IS NOT NULL

UNION

-- Customers linked via active tickets
SELECT DISTINCT
    c.CustomerId, c.CustomerName, c.SourceCustomerId, c.MerchandisingPhone, c.MerchandisingEmail, c.ExtendedPrimaryPhone,
    c.SupplementalEmail, c.MerchandisingCity, c.MerchandisingStateProvince, c.MerchandisingAddressLine1, c.MerchandisingPostalCode,
    c.ExtendedAddressLine1, c.ExtendedAddressLine2, c.ExtendedAddressLine3, c.ExtendedAddressLine4, c.ExtendedCity,
    c.ExtendedStateProvince, c.ExtendedPostalCode, c.ExtendedCountry, c.IndustryCode1, c.IndustryCode2, c.NopIdNumber,
    c.IsActive, c.EffectiveStartDate, c.EffectiveEndDate,
    t.OrganizationCode AS TradeUnit
FROM base.Customer c
INNER JOIN base.Ticket t ON t.CustomerId = c.CustomerId
WHERE c.IsActive    = 1
  AND c.IndustryCode1 = 'PR'
  AND c.CustomerName NOT LIKE '%DUP%'
  AND c.CustomerName NOT LIKE '%DO NOT USE%'
  AND LEFT(c.CustomerName, 1) NOT IN ('*', '$')
  AND t.ETL_Delete_Datetime IS NULL   -- was: t.IsActive = 1 AND t.IsDeleted = 0
  AND t.OrganizationCode IS NOT NULL;
```
Every filter and join, enumerated:
- **Customer filters, both branches:**
  - `c.IsActive = 1`.
  - `c.IndustryCode1 = 'PR'`.
  - `CustomerName NOT LIKE '%DUP%'`.
  - `CustomerName NOT LIKE '%DO NOT USE%'`.
  - `LEFT(CustomerName,1) NOT IN ('*','$')`.
  - There is NO `IsCurrent` filter on `base.Customer` in this view. `CustomerPaymentInfo` filters `IsCurrent`, and `vw_CurrentCustomers` is the "current" view.
  - There is NO `IsDuplicate = 0` filter in the view. `SearchOdsAsync` adds `c.IsDuplicate = 0`.
- **Contract branch:**
  - Join `con.CtrmCustomerId = c.SourceCustomerId` (the ScoularId, from `base.Contract` directly).
  - `con.IsActive = 1`.
  - `con.TradeUnit IS NOT NULL`.
  - There is no `ContractPrefixType` filter, so sale contracts count as well as purchases.
  - There is no closed-date filter: "active" is the ODS `IsActive` flag, not an open/closed state.
  - There is no `IsDeleted` filter in the script.
- **Ticket branch:**
  - Join `t.CustomerId = c.CustomerId`. This is the ODS surrogate on the ticket HEADER, not a detail customerCode.
  - `t.ETL_Delete_Datetime IS NULL`, so the soft-delete marker is the only ticket filter.
  - `t.OrganizationCode IS NOT NULL`.
  - There is no date window, no ticket-type filter, no consolidated or cancel filter. In all of time, any non-deleted ticket makes the pair.
- `UNION` plus `SELECT DISTINCT` dedupes (customer, TU).
- Trade-unit value is `con.TradeUnit` or `t.OrganizationCode`, unmodified (CHAR-padding is a possibility; `GetOpenActivityTradeUnitsAsync` trims).
- The script SELECTs `c.IsActive` but `CustomerTradeUnitView` does not declare it. `CustomerTradeUnitView.cs` states "ODS removed those columns (2026-08) and now filters inactive and deleted records out of the view itself". So the live view definition may differ from this script. Verify it against Dev ODS (`sp_helptext`).
- The ODS `CustomerId` is `base.Customer.CustomerId` (bigint surrogate); `SourceCustomerId` is the 5-7 char producer code.
- Other related ODS objects: `base.vw_CurrentCustomers` (current-customer master, used by onboarding search and the manual refresh) and `base.Customer` (payment method and the view source). `docs/performance/customer-trade-unit-map.md` is a stale 2026-03 proposal for a `CustomerTradeUnitMap` table, "Pending DBA execution".

---

## 7. CONVENTIONS (cite by section; the repo has NO root `AGENTS.md` or `CLAUDE.md`)
- The only `CLAUDE.md` in the tree is `developer-docs/CLAUDE.md` (Azure and infra context, not code style). Relevant sections: "Critical Constraint: Network Access", "Pre-configured App Settings", "Authentication", ".NET API Authentication Setup", "SQL Database", "Key Vault", "Application Insights", "Security Rules".
- That folder is synced from the infra repo (overwritten). App-owned process docs belong under `docs/`.
- **Shared style guides are not in-repo.** `style-guides/README.md` says they ship in the scoular-skills plugin. Installed copy: `C:\Users\CEgr\.claude\plugins\cache\scoular\scoular-skills\2.1.0\style-guides\`, with `csharp.md`, `angular.md`, `sql.md`, `security.md`, `logging.md`, `error-handling.md`, `automated-testing.md`, `permissions-model.md`. Do not copy them into the repo.
- Repo-local `style-guides/` holds only `refactoring-guide.md`, `error-smells-guide.md`, `integration-smells-guide.md`, `model-smells-guide.md`, `tagging.md`.
- Relevant plugin sections:
  - `csharp.md`: "Project Structure (Simplified Clean Architecture)", "Outbound Calls, Batching, and Caching" (Outbound Call Design, Batching Rules, Caching Rules, HTTP Client Rules, Review Heuristics), "Exception Handling", "Testing".
  - `error-handling.md`: §3.4 "Exceptions vs. Return Types", §4.1 "Required Structured Fields", §6 "Retry & Resilience", §10 "Testing Requirements".
  - `logging.md`: §4 "Required structured log schema", §6 "Correlation and distributed tracing", §7.2-7.3 "Where to log / What not to do".
  - `security.md`: §2 baseline, §4.3 "API-to-DB (Azure SQL)", §5 secrets.
  - `sql.md`: "Migration Standards" (File Naming, Idempotent Migrations, "Migrations Must Parse Before Merge"), "Foreign Keys and Referential Integrity", "Audit Columns", "Primary Keys".
  - `automated-testing.md`: §3.1 Naming, §6.1 Frameworks, §6.3 Unit tests, §6.4 Integration, §8 Data Layer, §7 Frontend.
  - `angular.md`: "Component Style", "Service Style", "Testing".
- **Background services**:
  - Existing patterns are `CustomerSyncBackgroundService` (daily `Task.Delay` schedule, 60 s startup run, `RunSyncSafelyAsync` with a TraceId scope) and `CtrmKeepWarmService` (1-minute `PeriodicTimer` with config re-read each tick).
  - Registered in `Program.cs` by `AddHostedService<>`. The logic class is a singleton using `IServiceScopeFactory`.
  - Tests exist for the ctrm one: `TEST/Services/CtrmKeepWarmServiceTests.cs` and `CtrmKeepWarmBackoffTests.cs` (static `ShouldWarmNow` internal). For the sync schedule there is `UsageAggregationScheduleTests.cs`.
- **New config sections**: follow the `appsettings.json` convention of `"// Key": "prose"` plus the key; empty or omitted means safe default; secrets never in the file; env overrides in `appsettings.{Dev,QA,Production,Development}.json`; read with `CtrmConfig.ReadInt/ReadBool` or the indexer with a fallback. Nothing validates config at startup (a malformed knob falls back).
- **EF migrations**:
  - Location: `INF/Data/Migrations/` (latest `20261005131626_DropCtrmSourceToggleUsers`, plus `ApplicationDbContextModelSnapshot.cs`).
  - The deploy workflows run `dotnet ef database update --context ApplicationDbContext` (`scripts/README-migrations.md`). Non-idempotent migrations break it, so use `IF NOT EXISTS` guards.
  - **`scripts/_VerifySchema.sql` update rule** (header "MAINTENANCE"): after every new migration (1) append the migration id to `@Migrations`, which must equal every `*.cs` in the Migrations folder except `*.Designer.cs` and the snapshot; (2) add or update rows in `@Tables`, `@Columns`, `@CheckConstraints`, `@UniqueIndexes` for new objects. The "five sections" are marked `### UPDATE WHEN SCHEMA CHANGES ###`.
  - `_VerifySchema.sql` currently lists `dbo.Customer` and `dbo.CustomerTradeUnit` (`CustomerTradeUnit` columns at l.264-272).
  - Per `docs/application-context/Usage Dashboard.md:359` it is "KEPT" and hand-maintained, and it is referenced by name in BarChart migrations. The audit confirms commits like `chore(schema): add ... to the drift check`.
  - **No `MigrationSnapshotConsistency` test exists** (grep for `MigrationSnapshot` returned nothing in `api/`).
- **Tests**:
  - Project is the nested `api/GrainOriginatorPortal.Api.Tests/GrainOriginatorPortal.Api.Tests/` (in the .sln). It has Moq 4.20.72 and NSubstitute 5.3.0 (`docs/testing/README.md`: new tests use NSubstitute, existing Moq stays until touched), xUnit 2.9.3, and `Microsoft.EntityFrameworkCore.InMemory` 10.0.0.
  - In-memory policy: `docs/testing/README.md` "Known gaps" #2 calls the EF InMemory provider an "Active §8 deviation" (two tests are named: Notes and PlantingIntentions controller tests), but many Repository tests use it (e.g. `ContractRepositorySwitchTests`, `CustomerRepositoryOpenActivityTests`, `CustomerRepositoryTradeUnitsTests`). `automated-testing.md` §8 bans InMemory for DB behaviour. No real-SQL integration tier exists (`Category=Integration` is reserved in `ci.yml`).
  - Layout: `Controllers/`, `Services/`, `Repositories/` (all `Ctrm*` tests live here), `Middleware/`, `Filters/`, `Authorization/`, root-level `ControllerAuthorizationTests.cs`, `CustomerAchTests.cs`, `CapturingLogger.cs`, `SqlExceptionDoubles.cs`.
  - Naming: `Method_Condition_Expected`, e.g. `SearchOds_ShortOrBlankTerm_ReturnsEmpty_WithoutQueryingOds`, `ValidateCustomerAccessAsync_WhenCustomerHasNoTradeUnitMapping_ThrowsForbidden`. Section comments `// Project namespaces` use grouped usings.
  - `ControllerAuthorizationTests` pattern: `AllControllerTypes()` is a `yield return new object[] { typeof(XController) }` list and a `[Theory][MemberData]` asserts `[Authorize]`. A new controller must be added to the list. `DiagnosticsController` and `CustomersController` are already listed. Controller policy for Diagnostics is `[Authorize(Policy = "AdminOnly")]`.
  - Mocking CTRM: `new Mock<ICtrmGraphQlClient>().Object`. Readers take an injectable `Func<DateTime> utcNow`. `CtrmTradeUnitThrottle.ResetForTests()` is a static reset (tests sharing static state must call it).
  - Ctrm query-shape tests: `CtrmQueryDocumentTests.cs` (guards against `#`), `CtrmContractReaderAliasedTests`, `CtrmServerTimeoutRetryTests`, `CtrmCustomerCodesTests`, `CtrmSyntheticIdTests`, `CtrmMappingsTests`, `CtrmOutageEndToEndTests`, `ContractRepositorySwitchTests` (config via `ConfigurationBuilder`).
  - `CustomerTradeUnitViewContractTests` pins the view-type shape; any new GraphQL row type that feeds `ApplyAttributes` needs an equivalent.
  - CI: `.github/workflows/ci.yml`. Backend `dotnet test GrainOriginatorPortal.sln --filter "Category!=Integration"`; frontend `npm test` (vitest).
- **Vitest**: co-located `*.spec.ts` (e.g. `api.service.spec.ts`, `nlq-filter.ach.spec.ts`, `organic-visibility.spec.ts`). Helpers in `client/src/testing/` (`provideTestEnvironment()`); Angular Testing Library; query by role, label or text, never Tailwind classes (`automated-testing.md` §7.4). `searchOdsCustomers` has no existing spec reference.
- **docs/application-context/CTRM GraphQL Data Source.md** (must be updated). Sections: What this is; How reads are routed; What comes from where (Ctrm:Source = ctrm); Rules preserved from ODS; Why the shapes are what they are; Trade-unit scope; Caching; Failure behaviour; Configuration; Turning CTRM on in Production (runbook); Deliberate divergences from ODS; Keeping the trade-unit caches warm; Projection scope; The last ODS contract and ticket reads; Known gaps (waiting on the API team); Testing notes.
  - The doc states "ODS by design, on both sources. These annotate or subtract from CTRM rows and never add one: customer master (`dbo.Customer`) ...". This text will need rewording.
  - `docs/application-context/README.md` "Keeping these docs accurate": update the corresponding doc in the same PR; each doc has a `## Files` table.
  - Other docs mentioning the view: `Planting Intentions Dashboard.md`, `Shared Infrastructure.md`, `Customer Home Page.md`. `docs/operations/OUTAGE-RECOVERY-PLAYBOOK.md` carries the sync's outage behaviour (§2 "During the outage — do not", C1, C2, E1, Appendix C baselines, Known gaps).
- **What's New**:
  - File `API/Content/whats-new.json`, newest release first. Entry shape: `{ "version": "2026.10.1", "releasedOn": "2026-10-06", "title", "summary", "items": [ { "group", "kind": "added|changed", "text" } ] }`.
  - Rule from `docs/application-context/Whats New.md`: "one deploy, one entry". Group items, do not split a release. If nothing user-visible changed, change nothing.
  - Nothing stamps release notes automatically. Update the file before dispatching `deploy-prod.yml`.
  - Latest entry is 2026.10.1 (CTRM go-live). `WhatsNewControllerTests` exist.
- **Feature flags / environment.ts**:
  - `client/src/environments/environment.ts` (and `.dev/.qa/.prod`) hold boolean flags: `bidSheetEnabled`, `usageDashboardEnabled`, `dailyDigestEnabled`, `teamsChannelMentionsEnabled`, `calculatorEnabled`, `ctrmReadAheadEnabled`, `remindersEnabled`. Each has an explanatory comment.
  - Server settings are the reversible-switch pattern (`Ctrm:Source`). No customer flag exists client-side. `Customer` has no source-awareness on the wire today.
- **Other conventions seen in code (not in a doc)**:
  - Structured error logging with `[{ErrorCode}] [{ErrorCategory}]`; audit logs use `"AUDIT_UPDATE", "DataMutation"`. Never log PII such as search terms or producer names.
  - Comments start with `// Project namespaces` / `// Microsoft namespaces` import grouping in `API/`.
  - Security notes cite accepted risks (AR-02, AR-03, AR-04). `SECURITY-REVIEWS/ACCEPTED-RISKS.md` governs any change to the customer-access or onboarding-search exposure.

---

## 8. DIAGNOSTICS (`API/Controllers/DiagnosticsController.cs`, 1105 lines)
- Class: `[ApiController] [Route("api/[controller]")] [Authorize(Policy = "AdminOnly")]`. The class comment says "Defense in depth: AdminOnly caller claim + DenyIfNotDevelopment() per-route env gate."
- Constructor injects `OriginationDbContext, ApplicationDbContext, TradeUnitPreferencesDbContext, ILogger<DiagnosticsController>, IWebHostEnvironment, IHttpClientFactory, CustomerSyncService, IGraphDirectoryClient, ICtrmGraphQlClient, IContractRepository, ITicketRepository, CtrmProvenance, CtrmContractReader, CtrmTicketReader, IConfiguration`.
- Env gates:
```csharp
private IActionResult? DenyIfNotDevelopment() => _env.IsDevelopment() || _env.IsEnvironment("QA") ? null : NotFound();
private IActionResult? DenyIfProduction() => _env.IsDevelopment() || _env.IsEnvironment("Dev") || _env.IsEnvironment("QA") ? null : NotFound();
```
- Routes:
  - `GET connections` (DenyIfNotDevelopment); `GET ctrm`, `GET ctrm/contracts?scoularId=`, `GET ctrm/alias-batch`, `GET ctrm/producer-timing?scoularId=&cold=` (DenyIfProduction); `GET tables`, `tableschema/{t}`, `schema/{t}`.
  - `POST customer-sync/run` (no env gate); `POST usage-rollups/backfill`; `GET app-access-group-members`; `POST commodities/seed`; `POST elevator-cache/refresh|geocode|geocode-zip`; `GET elevator-cache/geocode-status`.
- Shape of the ODS-vs-CTRM compare today. It is a SINGLE-source probe, not a diff: you call it, flip `Ctrm:Source`, call again and diff by hand.
  - `GET ctrm/contracts?scoularId=` returns an anonymous object. `BadRequest(new { Error = "scoularId is required ..." })` on blank.
```csharp
Ok(new { ScoularId, ServedBy = _contracts is ContractRepositorySwitch { UsingCtrm: true } ? "ctrm" : "ods",
  ContractCount, PricingLineCount,
  Contracts = contracts.Select(c => new { c.Id, Synthetic = CtrmSyntheticId.IsSynthetic(c.Id), c.SourceContractId, c.CtrmCustomerId, c.CommodityCode, c.Quantity, c.OpenBalanceQuantity, c.SettledQuantity, c.PriceTypeCode, Status = c.Status.ToString(), c.ContractDate, c.DeliveryStart, c.DeliveryEnd, c.ClosedDate, c.CropYear, c.CustomerConfirmStatus, c.HedgeMarketMonthDescription, PricingLines = ... }) })
```
  - `GET ctrm` connectivity probe returns `{ Configured = _ctrm.IsConfigured, Source = _config.GetValue<string>("Ctrm:Source"), Endpoint = ..., Window = new { From, To }, Status = result.Status.ToString(), result.HttpStatus, result.ErrorCode, result.Detail, TotalCountInWindow, SampleContractId, Healthy = result.Ok && totalCount is > 0 }`.
  - It runs the raw document through `_ctrm.QueryAsync<JsonElement>(document, new { from, to }, ct)`. A customers probe could do the same.
  - `ctrm/producer-timing` times the repository stack with a stopwatch and provenance per stage, with no producer data beyond counts.
- Responses use anonymous types (no named response DTOs). The diagnostic controller deliberately includes only counts and identifiers, no PII ("No producer data in the response beyond row counts").
- Test: `TEST/Controllers/DiagnosticsControllerAppAccessTests.cs` (InMemory contexts).

---

## 9. OPEN QUESTIONS (list only)
1. Id minting for customers that exist in GraphQL but have no `dbo.Customer` row.
   - `Customer.Id` is `ValueGeneratedNever`, with no sequence and no identity.
   - What is `max(CustomerId)` in ODS `base.Customer` and in `dbo.Customer` in each environment?
   - `CtrmSyntheticId` band 7e15 to 9e15 is reserved for contracts and tickets. The id must stay under 2^53 for JS (the client models `id: number`).
   - Is GraphQL `customer.id` (Profisee) numeric, stable and comparable to the ODS `CustomerId`, or unrelated?
   - Is `sourceSystem` a discriminator?
   - Does an inserted customer's id need to stay equal to the ODS `CustomerId` while `CustomerSync:Source = ods` is still reversible?
   - Is a new SQL `SEQUENCE` plus a migration plus `_VerifySchema.sql` rows acceptable?
2. Does the `customers(sourceCodes: [String!])` list filter exist? Is `sourceCode` equal to `ScoularId` with identical trimming and casing? `dbo.Customer.ScoularId` has a non-unique index, so duplicates are possible. What happens when GraphQL has more than one customer per `sourceCode` (`mdmMasterRecord`, `mdmMatchStatus`, `workflowStatus`, `intercompany`)?
3. Translating the view filters into GraphQL:
   - `IndustryCode1 = 'PR'` (available now as `industryCode1`, but there is no filter yet; filtering client-side means paging about 302K customers).
   - `IsActive = 1` maps to `activeYN = 'Y'`.
   - Name-based exclusions (`DUP`, `DO NOT USE`, leading `*` or `$`).
   - `IsDuplicate = 0` (`duplicateYN` is not available yet; `SearchOdsAsync` uses `IsDuplicate`).
   - `IsCurrent` versus MDM master record.
   - The `EffectiveStartDate` and `EffectiveEndDate` columns have no GraphQL equivalent.
4. "Active contract" in the view is `base.Contract.IsActive = 1`, with all prefixes and no closed-date test, versus GraphQL `closedDate` ('0001-01-01' means open, via `NullIfSentinel`) and `contractPrefixType`. Should TU derivation use purchase only, open only, or include closed contracts for parity? `IsOpenOrRecent` in `CtrmContractRepository` is "ClosedDate IS NULL OR <= sentinel OR CropYear >= year - 1". Contract `tradeUnit` null handling: the view requires `TradeUnit IS NOT NULL`.
5. "Non-deleted ticket" has no GraphQL equivalent (`ETL_Delete_Datetime IS NULL`). The view has no date window, so the GraphQL tickets read needs `blDateFrom/To` of at most 366 days. `CancelFlag`, type U/P and Consolidated rules apply in `CtrmMappings`, and the ODS view applied none of them. The view joins on the header `CustomerId` while GraphQL carries `customerCode` on the detail. A split load can carry a different `customerCode`. Is `organizationCode` on the detail the same value as `base.Ticket.OrganizationCode`? Which lookback (`Ctrm:TicketLookbackDays` is 1095)?
6. Cost and architecture of TU derivation: the "contracts/tickets we already fetch via CTRM" are fetched per TU producer set, resolved FROM `dbo.CustomerTradeUnit` (circular, see `ResolveScopedProducerCodesAsync`). A full derivation without a producer set needs either `contracts` without a customer filter (requires a date range; `customerIds` caps at 500 and costs about 25 s cold per chunk, with about 16,763 PR producers measured as 34 chunks at about 90 s, per code comments) or the requested customer to tradeUnit pair query. Rate limits: the PROD identity gets 3,000 calls per 60 s; nonprod batch concurrency is 4; the keep-warm service and the sync would contend for `CtrmTradeUnitThrottle` slots. Does the nightly sync need its own concurrency budget and the `Interactive()` deference?
7. Per-request access check: where should the "own table" read live and cache? `ValidateCustomerAccessAsync` is not called on any request path (AR-02). Do the three tests keep passing with `dbo.CustomerTradeUnit`? Which row filter (`IsActive` only, include `IsManual`, exclude `UserDeactivated`) reproduces "any TU in the view"? No customer-side caching exists today (only the per-user entitlement set is cached).
8. Startup sync versus the outage playbook: the sync runs 60 s after every start when `RunAtTimeUtc` is set, and there is no empty-source guard (playbook §2, C2, Known gaps). The guard threshold (percent of active customers and TU links, absolute floor, empty-source refusal), whether it applies to the `ods` source too, how it surfaces (log code, `CustomerSyncResult` field, the manual endpoint), and whether `POST customer-sync/run` bypasses it. Today there is no persisted last-run record. Where do the GraphQL `Throttled`, `Unauthorized` and `PartialSuccess` outcomes fit (PartialSuccess must not drive deactivation)? A set reading as truncated (`TRUNCATED` log) must never deactivate.
9. `CustomerSync:Source` semantics: values `ods|ctrm` (literal `ctrm` opt-in, anything else ods, per the Ctrm convention). Per-call read versus the singleton service. A restart is needed when the credential changes (the client is built once). Where do manual producers (`IsManual`) refresh from when the source is `ctrm` (today `LoadCurrentCustomerMasterAsync`)? Should `Ctrm:Source` also gate it? What happens to the "graduation" and bring-back passes (they call the switch-backed contract and ticket repositories)?
10. Staging for not-yet-available fields (`email`, extended address, `nopidNo`, `paymentMethod`, `duplicateYN`):
    - Which `dbo.Customer` columns must stay ODS-sourced until the fields land: `Email`, `SupplementalEmail`, `ExtendedPrimaryPhone`, `ExtendedAddress*`, `NopIdNumber`? A GraphQL-sourced sync must not blank them (`ApplyAttributes` assigns unconditionally).
    - A missing field returns HTTP 400 for the whole query, so the document must only name fields that exist. A future field needs a code and config gate.
    - `IndustryCode2` and `industryCode3` are available now (organic badge uses `IndustryCode2 == "OR"`), but NOP id is not.
    - ACH: today via `base.Customer.PaymentMethod == 'H'` through `CustomerPaymentInfo` at read time. Does the target (`paymentMethod`) belong on `dbo.Customer` (needs migration) or still a read-time enrichment (live GraphQL per list read is a latency and rate risk)? `GetById` currently does not enrich ACH.
    - The merchandising fields not stored today: `merchandisingName`, `AddressLine2`, `Country`.
11. Add-customer search via GraphQL: `nameContains` and `sourceCode` filters exist, but there is no multi-word AND search and no phone or ScoularId substring (current SQL matches name, `ScoularId` and `SourceCustomerId` with `LIKE '%w%'`). `take` is at most 500, and the old result cap was 50. The `customers` query needs `industryCode1 = 'PR'` (no filter) or client-side filtering of a paged 302K set. The candidate id sent by the client to `PUT /customers/{id}/trade-units` (id semantics, see #1) and the `AssignTradeUnitsAsync` re-read via `GetOdsCustomerRowAsync`. AR-04's minimum 3 characters and PII exposure still apply. Interaction with the dedupe against existing `dbo.Customer` ids (now by `sourceCode`).
12. Diff report: Dev-only gate (`DenyIfProduction` allows Dev, QA and Development; `DenyIfNotDevelopment` allows only Development and QA, a documented trap). Output shape (counts, missing, extra, field diffs, no PII like the existing probes). Whether it lives in `DiagnosticsController` (already 1105 lines) or a new controller (then add it to `ControllerAuthorizationTests.AllControllerTypes`).
13. Where the new reader goes: reuse `ICtrmGraphQlClient` (same credential or audience, so the separate `Customers.Read.All` permission may need a different app registration or a role on the same client). The diagnostics `Healthy` test is contracts-only.
14. The ODS live `vw_CustomerTradeUnits` definition is not guaranteed to match the repo script (the script SELECTs `c.IsActive` while the code says the column was removed; dev-applied 2026-09-21, QA and PROD still owed). The PROD view ALTER is manual in every environment.
15. Migration needs? `dbo.Customer` likely needs no change for stage 1 (match on `ScoularId`). A `SourceSystem` or `LastChangedUtc` column, an MDM id column, a unique index on `ScoularId` (currently non-unique), or a sync-run table (the playbook says none exists) would each need a migration, `_VerifySchema.sql` updates and a Designer file. There is no `MigrationSnapshotConsistency` test to extend.
16. What's New and docs: does any of this change anything a user would notice (the ACH badge and the add-customer search could)? Per "one deploy, one entry", nothing changes if not.
17. Test strategy: no real-SQL integration tier. `CustomerSyncService` has no existing unit tests (only `CustomerTradeUnitViewContractTests` for the view shape), and `ICustomerSyncRepository` is the seam for them. Static `CtrmTradeUnitThrottle` state across tests needs `ResetForTests()`.