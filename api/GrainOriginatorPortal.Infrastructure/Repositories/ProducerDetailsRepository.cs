using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class ProducerDetailsRepository : IProducerDetailsRepository
{
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<ProducerDetailsRepository> _logger;

    public ProducerDetailsRepository(ApplicationDbContext appContext, ILogger<ProducerDetailsRepository> logger)
    {
        _appContext = appContext;
        _logger = logger;
    }

    public async Task<ProducerDetails?> GetAsync(long customerId, CancellationToken cancellationToken)
    {
        var pd = await _appContext.ProducerDetails.AsNoTracking()
            .Include(p => p.Customer)
            .FirstOrDefaultAsync(p => p.CustomerId == customerId, cancellationToken);
        if (pd == null) return null;

        // CustomerName / ScoularId now come from the Customer FK join
        // (the columns were dropped from dbo.ProducerDetails in Phase 3b).
        pd.CustomerName = pd.Customer?.Name ?? string.Empty;
        pd.ScoularId = pd.Customer?.ScoularId;
        // LinkedProducerIds (CSV of linked-producer ScoularIds) is composed from
        // dbo.CustomerLink — the CSV column was dropped in Phase 3b.
        pd.LinkedProducerIds = await GetLinkedProducerCsvAsync(customerId, cancellationToken);
        // Commodities (CSV of commodity codes) is composed from dbo.CustomerCommodity
        // — the CSV column was dropped in Phase 4b.
        pd.Commodities = await GetCommodityCodesCsvAsync(customerId, cancellationToken);
        // Per-commodity grain-on-farm breakdown composed from dbo.ProducerGrainOnFarm.
        pd.GrainOnFarm = await GetGrainOnFarmAsync(customerId, cancellationToken);
        // User-entered contacts composed from dbo.ProducerContact (primary first).
        pd.Contacts = await GetContactsAsync(customerId, cancellationToken);
        // User-entered bin sites composed from dbo.ProducerBinSite.
        pd.BinSites = await GetBinSitesAsync(customerId, cancellationToken);
        return pd;
    }

    public async Task<List<ProducerDetails>> GetAllAsync(CancellationToken cancellationToken)
    {
        var all = await _appContext.ProducerDetails.AsNoTracking()
            .Include(p => p.Customer)
            .ToListAsync(cancellationToken);

        // Batch-fetch all CustomerLink rows for these producers in one round-trip,
        // then group in memory and assign as comma-separated ScoularIds.
        var customerIds = all.Select(p => p.CustomerId).Distinct().ToList();
        var linkRows = await _appContext.CustomerLinks.AsNoTracking()
            .Where(l => customerIds.Contains(l.FromCustomerId))
            .Join(_appContext.Customers.AsNoTracking(),
                  l => l.ToCustomerId,
                  c => c.Id,
                  (l, c) => new { l.FromCustomerId, c.ScoularId })
            .Where(x => x.ScoularId != null)
            .ToListAsync(cancellationToken);
        var linksByFrom = linkRows
            .GroupBy(x => x.FromCustomerId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ScoularId!).ToList());

        // Same batching pattern for CustomerCommodity → commodity codes.
        var commodityRows = await _appContext.CustomerCommodities.AsNoTracking()
            .Where(cc => customerIds.Contains(cc.CustomerId))
            .Join(_appContext.Commodities.AsNoTracking(),
                  cc => cc.CommodityId,
                  c => c.Id,
                  (cc, c) => new { cc.CustomerId, c.Code })
            .Where(x => !string.IsNullOrEmpty(x.Code))
            .ToListAsync(cancellationToken);
        var commoditiesByCustomer = commodityRows
            .GroupBy(x => x.CustomerId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Code).ToList());

        // Same batching pattern for ProducerGrainOnFarm → per-commodity on-hand/grade/target rows.
        var grainRows = await _appContext.ProducerGrainOnFarm.AsNoTracking()
            .Where(g => customerIds.Contains(g.CustomerId))
            .Select(g => new { g.CustomerId, g.CommodityCode, g.BushelsOnHand, g.TargetBushels, g.Grade })
            .ToListAsync(cancellationToken);
        var grainByCustomer = grainRows
            .GroupBy(x => x.CustomerId)
            .ToDictionary(g => g.Key, g => g.Select(x => new GrainOnFarmEntry
            {
                CommodityCode = x.CommodityCode,
                BushelsOnHand = x.BushelsOnHand,
                TargetBushels = x.TargetBushels,
                Grade = x.Grade
            }).ToList());

        // Same batching pattern for ProducerContact → contact rows, primary first.
        var contactRows = await _appContext.ProducerContacts.AsNoTracking()
            .Where(c => customerIds.Contains(c.CustomerId))
            .OrderByDescending(c => c.IsPrimary).ThenBy(c => c.SortOrder).ThenBy(c => c.Id)
            .ToListAsync(cancellationToken);
        var contactsByCustomer = contactRows
            .GroupBy(x => x.CustomerId)
            .ToDictionary(g => g.Key, g => g.Select(x => new ProducerContactEntry
            {
                Name = x.Name,
                Phone = x.Phone,
                Email = x.Email,
                IsPrimary = x.IsPrimary,
                SortOrder = x.SortOrder
            }).ToList());

        // Same batching pattern for ProducerBinSite → bin-site rows in display order.
        var binSiteRows = await _appContext.ProducerBinSites.AsNoTracking()
            .Where(b => customerIds.Contains(b.CustomerId))
            .OrderBy(b => b.SortOrder).ThenBy(b => b.Id)
            .ToListAsync(cancellationToken);
        var binSitesByCustomer = binSiteRows
            .GroupBy(x => x.CustomerId)
            .ToDictionary(g => g.Key, g => g.Select(x => new ProducerBinSiteEntry
            {
                Name = x.Name,
                Latitude = x.Latitude,
                Longitude = x.Longitude,
                Capacity = x.Capacity,
                CommodityCode = x.CommodityCode,
                SortOrder = x.SortOrder
            }).ToList());

        foreach (var p in all)
        {
            p.CustomerName = p.Customer?.Name ?? string.Empty;
            p.ScoularId = p.Customer?.ScoularId;
            p.LinkedProducerIds = linksByFrom.TryGetValue(p.CustomerId, out var ids) && ids.Count > 0
                ? string.Join(",", ids)
                : null;
            p.Commodities = commoditiesByCustomer.TryGetValue(p.CustomerId, out var codes) && codes.Count > 0
                ? string.Join(",", codes)
                : null;
            p.GrainOnFarm = grainByCustomer.TryGetValue(p.CustomerId, out var grain) ? grain : new();
            p.Contacts = contactsByCustomer.TryGetValue(p.CustomerId, out var contacts) ? contacts : new();
            p.BinSites = binSitesByCustomer.TryGetValue(p.CustomerId, out var binSites) ? binSites : new();
        }
        return all;
    }

    public async Task<ProducerDetails> UpsertAsync(ProducerDetailsUpsertArgs args, string currentUser, CancellationToken cancellationToken)
    {
        var customerId = args.CustomerId;
        var (scoularId, customerName) = (args.ScoularId, args.CustomerName);
        var (totalAcres, binCapacity) = (args.TotalAcres, args.BinCapacity);
        var (commodities, linkedProducerIds) = (args.Commodities, args.LinkedProducerIds);
        var grainOnFarm = args.GrainOnFarm;

        // Contacts drive the legacy PrimaryContact/PrimaryPhone columns (dual-write). When the
        // request didn't include contacts at all (old client during a deploy window), fall through
        // to the legacy fields as-sent and leave existing contact rows untouched.
        var contactItems = args.Contacts == null ? null : NormalizeContacts(args.Contacts);
        var primaryRow = contactItems?.FirstOrDefault(c => c.IsPrimary);
        var primaryContact = contactItems == null ? args.PrimaryContact : primaryRow?.Name;
        var primaryPhone = contactItems == null ? args.PrimaryPhone : primaryRow?.Phone;
        var binSiteItems = args.BinSites == null ? null : NormalizeBinSites(args.BinSites);

        var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);

        ProducerDetails saved;
        if (existing != null)
        {
            // ScoularId / CustomerName are kept on the in-memory entity for the
            // API response, but EF .Ignore()s them — they're not persisted to
            // dropped columns. The canonical values come from dbo.Customer.
            existing.ScoularId = scoularId;
            existing.CustomerName = customerName;
            existing.TotalAcres = totalAcres;
            existing.BinCapacity = binCapacity;
            existing.PrimaryContact = primaryContact;
            existing.PrimaryPhone = primaryPhone;
            existing.Commodities = commodities;
            existing.LinkedProducerIds = linkedProducerIds;  // in-memory only; persisted via CustomerLink rebuild below
            existing.ModifiedBy = currentUser;
            existing.ModifiedAt = DateTime.UtcNow;
            saved = existing;
        }
        else
        {
            saved = new ProducerDetails
            {
                CustomerId = customerId,
                ScoularId = scoularId,
                CustomerName = customerName,
                TotalAcres = totalAcres,
                BinCapacity = binCapacity,
                PrimaryContact = primaryContact,
                PrimaryPhone = primaryPhone,
                Commodities = commodities,
                LinkedProducerIds = linkedProducerIds,
                CreatedBy = currentUser,
                CreatedAt = DateTime.UtcNow
            };
            _appContext.ProducerDetails.Add(saved);
        }

        // Rebuild dbo.CustomerLink for this from-customer in the same EF
        // transaction as the ProducerDetails write. Drop all existing links
        // and re-insert based on the supplied CSV of linked ScoularIds.
        var oldLinks = await _appContext.CustomerLinks
            .Where(l => l.FromCustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (oldLinks.Count > 0)
        {
            _appContext.CustomerLinks.RemoveRange(oldLinks);
        }
        if (!string.IsNullOrWhiteSpace(linkedProducerIds))
        {
            var ids = linkedProducerIds
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var toCustomerIds = await _appContext.Customers.AsNoTracking()
                .Where(c => c.ScoularId != null && ids.Contains(c.ScoularId))
                .Select(c => c.Id)
                .ToListAsync(cancellationToken);
            foreach (var toId in toCustomerIds.Where(id => id != customerId).Distinct())
            {
                _appContext.CustomerLinks.Add(new CustomerLink
                {
                    FromCustomerId = customerId,
                    ToCustomerId = toId
                });
            }
        }

        // Same rebuild pattern for dbo.CustomerCommodity. Parse the CSV of
        // commodity codes, resolve each to a CommodityId via dbo.Commodities,
        // and replace the customer's commodity set in the same transaction.
        // Codes not in the lookup are silently skipped — the UI's commodity
        // picker only surfaces valid codes.
        var oldCommodities = await _appContext.CustomerCommodities
            .Where(cc => cc.CustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (oldCommodities.Count > 0)
        {
            _appContext.CustomerCommodities.RemoveRange(oldCommodities);
        }
        if (!string.IsNullOrWhiteSpace(commodities))
        {
            var codes = commodities
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var commodityIds = await _appContext.Commodities.AsNoTracking()
                .Where(c => codes.Contains(c.Code))
                .Select(c => c.Id)
                .ToListAsync(cancellationToken);
            foreach (var commodityId in commodityIds.Distinct())
            {
                _appContext.CustomerCommodities.Add(new CustomerCommodity
                {
                    CustomerId = customerId,
                    CommodityId = commodityId
                });
            }
        }

        // Same rebuild pattern for dbo.ProducerGrainOnFarm — replace the customer's per-commodity
        // grain-on-farm set. Dedupe by commodity code (last write wins); skip blank codes.
        var oldGrain = await _appContext.ProducerGrainOnFarm
            .Where(g => g.CustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (oldGrain.Count > 0)
        {
            _appContext.ProducerGrainOnFarm.RemoveRange(oldGrain);
        }
        var grainItems = grainOnFarm
            .Where(g => !string.IsNullOrWhiteSpace(g.CommodityCode))
            .GroupBy(g => g.CommodityCode.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.Last())
            .ToList();
        foreach (var item in grainItems)
        {
            _appContext.ProducerGrainOnFarm.Add(new ProducerGrainOnFarm
            {
                CustomerId = customerId,
                CommodityCode = item.CommodityCode.Trim(),
                BushelsOnHand = item.BushelsOnHand,
                TargetBushels = item.TargetBushels,
                Grade = string.IsNullOrWhiteSpace(item.Grade) ? null : item.Grade.Trim()
            });
        }

        // Same rebuild pattern for dbo.ProducerContact — but ONLY when the request carried a
        // contacts list. Null means "not provided" and must preserve the existing rows, so an
        // old-shape client payload can never wipe contacts mid-deploy.
        if (contactItems != null)
        {
            var oldContacts = await _appContext.ProducerContacts
                .Where(c => c.CustomerId == customerId)
                .ToListAsync(cancellationToken);
            if (oldContacts.Count > 0)
            {
                _appContext.ProducerContacts.RemoveRange(oldContacts);
            }
            foreach (var item in contactItems)
            {
                _appContext.ProducerContacts.Add(new ProducerContact
                {
                    CustomerId = customerId,
                    Name = item.Name,
                    Phone = item.Phone,
                    Email = item.Email,
                    IsPrimary = item.IsPrimary,
                    SortOrder = item.SortOrder
                });
            }
        }

        // Same rebuild for dbo.ProducerBinSite, with the same null-means-preserve contract.
        if (binSiteItems != null)
        {
            var oldBinSites = await _appContext.ProducerBinSites
                .Where(b => b.CustomerId == customerId)
                .ToListAsync(cancellationToken);
            if (oldBinSites.Count > 0)
            {
                _appContext.ProducerBinSites.RemoveRange(oldBinSites);
            }
            foreach (var item in binSiteItems)
            {
                _appContext.ProducerBinSites.Add(new ProducerBinSite
                {
                    CustomerId = customerId,
                    Name = item.Name,
                    Latitude = item.Latitude,
                    Longitude = item.Longitude,
                    Capacity = item.Capacity,
                    CommodityCode = item.CommodityCode,
                    SortOrder = item.SortOrder
                });
            }
        }

        await _appContext.SaveChangesAsync(cancellationToken);
        // Reflect the persisted child sets back on the returned entity so the upsert response
        // carries them.
        //
        // These two reads look redundant — an audit flagged them as such — but they are not, and
        // replacing them with the in-memory values would introduce a bug:
        //   • Contacts: a null contactItems means "not provided", which deliberately PRESERVES the
        //     existing rows (see above). The request carries nothing in that case, so the DB is the
        //     only place the current contacts exist.
        //   • Ordering: GetContactsAsync returns primary-first, then SortOrder, then Id. The
        //     normalized request list isn't guaranteed to be in that order, so the client would get
        //     a different order depending on which path produced the response.
        // If this is ever optimised, it has to be GrainOnFarm only, and the ordering has to be
        // reproduced in memory rather than assumed.
        saved.GrainOnFarm = await GetGrainOnFarmAsync(customerId, cancellationToken);
        saved.Contacts = await GetContactsAsync(customerId, cancellationToken);
        // Bin sites follow the contacts reasoning: null preserves, so the DB is the source.
        saved.BinSites = await GetBinSitesAsync(customerId, cancellationToken);
        // Structured AUDIT_UPDATE, matching the delete below. M-045 (2026-09-21) found this path
        // emitting only a plain LogInformation with no audit code and no actor -- the same gap
        // H-062 closed on the delete. The row does carry ModifiedBy, so the write was attributable,
        // but not from the log alone. Contact counts are included because this path overwrites
        // ProducerContact PII (names, phones, emails).
        _logger.LogInformation(
            "Producer details upserted [{ErrorCode}] [{ErrorCategory}]: CustomerId={CustomerId} User={User} Contacts={Contacts} GrainRows={GrainRows} BinSites={BinSites}",
            "AUDIT_UPDATE", "DataMutation", customerId, currentUser, saved.Contacts.Count, saved.GrainOnFarm.Count, saved.BinSites.Count);
        return saved;
    }

    /// <summary>
    /// Cleans and normalizes incoming contact rows: trims every field, drops rows with a blank
    /// name, defensively caps lengths, collapses exact duplicates (same name/label/phone/email,
    /// case-insensitive), and enforces exactly one primary — the first flagged row wins; when none
    /// is flagged the first row becomes primary. SortOrder is the post-filter position so the
    /// client's array order is the display order.
    /// </summary>
    private static List<ProducerContactEntry> NormalizeContacts(IReadOnlyList<ProducerContactEntry> contacts)
    {
        static string? Clean(string? value, int max)
        {
            var trimmed = value?.Trim();
            if (string.IsNullOrEmpty(trimmed)) return null;
            return trimmed.Length <= max ? trimmed : trimmed[..max];
        }

        var cleaned = contacts
            .Select(c => new ProducerContactEntry
            {
                Name = Clean(c.Name, 200) ?? string.Empty,
                Phone = Clean(c.Phone, 50),
                Email = Clean(c.Email, 255),
                IsPrimary = c.IsPrimary
            })
            .Where(c => c.Name.Length > 0)
            .GroupBy(c => $"{c.Name}|{c.Phone}|{c.Email}", StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        var primaryIndex = cleaned.FindIndex(c => c.IsPrimary);
        if (primaryIndex < 0 && cleaned.Count > 0) primaryIndex = 0;
        for (var i = 0; i < cleaned.Count; i++)
        {
            cleaned[i].IsPrimary = i == primaryIndex;
            cleaned[i].SortOrder = i;
        }
        return cleaned;
    }

    /// <summary>
    /// Cleans incoming bin-site rows: trims the name (blank becomes null) and caps its length,
    /// keeps the coordinates as pasted (only rounding past the column's 15 places, so a value can
    /// never fail to fit), and collapses rows that are exact duplicates in every field. Coordinates
    /// are optional now (only the Name is required, 2026-10-09), so collapsing on the point alone
    /// would merge every site that has none. Range and required checks are the request model's job;
    /// this only normalizes. SortOrder is the post-filter position.
    /// </summary>
    private static List<ProducerBinSiteEntry> NormalizeBinSites(IReadOnlyList<ProducerBinSiteEntry> binSites)
    {
        static decimal? Round(decimal? v) =>
            v.HasValue ? Math.Round(v.Value, BinSiteRules.StoredDecimalPlaces, MidpointRounding.AwayFromZero) : null;

        var cleaned = binSites
            .Select(b =>
            {
                var name = b.Name?.Trim();
                if (name?.Length > BinSiteRules.NameMaxLength) name = name[..BinSiteRules.NameMaxLength];
                return new ProducerBinSiteEntry
                {
                    Name = string.IsNullOrEmpty(name) ? null : name,
                    Latitude = Round(b.Latitude),
                    Longitude = Round(b.Longitude),
                    Capacity = b.Capacity,
                    CommodityCode = string.IsNullOrWhiteSpace(b.CommodityCode) ? null : b.CommodityCode.Trim()
                };
            })
            .GroupBy(b => (Name: b.Name?.ToUpperInvariant(), b.Latitude, b.Longitude, b.Capacity,
                           Commodity: b.CommodityCode?.ToUpperInvariant()))
            .Select(g => g.First())
            .ToList();

        for (var i = 0; i < cleaned.Count; i++)
        {
            cleaned[i].SortOrder = i;
        }
        return cleaned;
    }

    public async Task<bool> DeleteAsync(long customerId, string currentUser, CancellationToken cancellationToken)
    {
        var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);
        if (existing == null) return false;

        // Child rows FK to dbo.Customer (not ProducerDetails), so they don't cascade — remove
        // them explicitly or they'd silently reattach if details are ever re-created.
        var contacts = await _appContext.ProducerContacts
            .Where(c => c.CustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (contacts.Count > 0) _appContext.ProducerContacts.RemoveRange(contacts);
        var binSites = await _appContext.ProducerBinSites
            .Where(b => b.CustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (binSites.Count > 0) _appContext.ProducerBinSites.RemoveRange(binSites);
        var grain = await _appContext.ProducerGrainOnFarm
            .Where(g => g.CustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (grain.Count > 0) _appContext.ProducerGrainOnFarm.RemoveRange(grain);

        _appContext.ProducerDetails.Remove(existing);
        await _appContext.SaveChangesAsync(cancellationToken);

        // Structured AUDIT_DELETE, matching CustomerRepository. This delete hand-cascades to child
        // rows that exist nowhere upstream, so the cascade counts belong in the audit trail — a
        // plain LogInformation left AR-01's stated "every mutation is attributable" control
        // unsatisfied for this route (H-062, 2026-09-14).
        //
        // ⚠ User={User} added 2026-09-21. The H-062 fix added the audit code and the cascade
        // counts but NOT the actor, and this is a HARD delete — Remove() on the details row plus
        // RemoveRange() on contacts and grain. Nothing survives to carry a DeletedBy, so this line
        // is the only record of who destroyed a producer's contact PII. Do not drop User from it.
        _logger.LogInformation(
            "Producer details deleted [{ErrorCode}] [{ErrorCategory}]: CustomerId={CustomerId} User={User} ContactsRemoved={ContactsRemoved} GrainRowsRemoved={GrainRowsRemoved} BinSitesRemoved={BinSitesRemoved}",
            "AUDIT_DELETE", "DataMutation", customerId, currentUser, contacts.Count, grain.Count, binSites.Count);
        return true;
    }

    /// <summary>
    /// Composes the comma-separated list of linked-producer ScoularIds for a given
    /// from-customer by joining dbo.CustomerLink → dbo.Customer.ScoularId. Returns
    /// null when there are no links, matching the prior nullable-CSV semantics.
    /// </summary>
    private async Task<string?> GetLinkedProducerCsvAsync(long fromCustomerId, CancellationToken cancellationToken)
    {
        var scoularIds = await _appContext.CustomerLinks.AsNoTracking()
            .Where(l => l.FromCustomerId == fromCustomerId)
            .Join(_appContext.Customers.AsNoTracking(),
                  l => l.ToCustomerId,
                  c => c.Id,
                  (l, c) => c.ScoularId)
            .Where(s => s != null)
            .ToListAsync(cancellationToken);
        return scoularIds.Count == 0 ? null : string.Join(",", scoularIds!);
    }

    /// <summary>
    /// Composes the comma-separated list of commodity codes a customer grows
    /// by joining dbo.CustomerCommodity → dbo.Commodities.Code. Returns null
    /// when there are no rows, matching the prior nullable-CSV semantics on
    /// ProducerDetails.Commodities.
    /// </summary>
    private async Task<string?> GetCommodityCodesCsvAsync(long customerId, CancellationToken cancellationToken)
    {
        var codes = await _appContext.CustomerCommodities.AsNoTracking()
            .Where(cc => cc.CustomerId == customerId)
            .Join(_appContext.Commodities.AsNoTracking(),
                  cc => cc.CommodityId,
                  c => c.Id,
                  (cc, c) => c.Code)
            .Where(code => !string.IsNullOrEmpty(code))
            .ToListAsync(cancellationToken);
        return codes.Count == 0 ? null : string.Join(",", codes);
    }

    /// <summary>Composes the contact rows for a customer from dbo.ProducerContact, primary first.</summary>
    private async Task<List<ProducerContactEntry>> GetContactsAsync(long customerId, CancellationToken cancellationToken)
    {
        return await _appContext.ProducerContacts.AsNoTracking()
            .Where(c => c.CustomerId == customerId)
            .OrderByDescending(c => c.IsPrimary).ThenBy(c => c.SortOrder).ThenBy(c => c.Id)
            .Select(c => new ProducerContactEntry
            {
                Name = c.Name,
                Phone = c.Phone,
                Email = c.Email,
                IsPrimary = c.IsPrimary,
                SortOrder = c.SortOrder
            })
            .ToListAsync(cancellationToken);
    }

    /// <summary>Composes the bin-site rows for a customer from dbo.ProducerBinSite, in display order.</summary>
    private async Task<List<ProducerBinSiteEntry>> GetBinSitesAsync(long customerId, CancellationToken cancellationToken)
    {
        return await _appContext.ProducerBinSites.AsNoTracking()
            .Where(b => b.CustomerId == customerId)
            .OrderBy(b => b.SortOrder).ThenBy(b => b.Id)
            .Select(b => new ProducerBinSiteEntry
            {
                Name = b.Name,
                Latitude = b.Latitude,
                Longitude = b.Longitude,
                Capacity = b.Capacity,
                CommodityCode = b.CommodityCode,
                SortOrder = b.SortOrder
            })
            .ToListAsync(cancellationToken);
    }

    /// <summary>Composes the per-commodity grain-on-farm rows for a customer from dbo.ProducerGrainOnFarm.</summary>
    private async Task<List<GrainOnFarmEntry>> GetGrainOnFarmAsync(long customerId, CancellationToken cancellationToken)
    {
        return await _appContext.ProducerGrainOnFarm.AsNoTracking()
            .Where(g => g.CustomerId == customerId)
            .Select(g => new GrainOnFarmEntry
            {
                CommodityCode = g.CommodityCode,
                BushelsOnHand = g.BushelsOnHand,
                TargetBushels = g.TargetBushels,
                Grade = g.Grade
            })
            .ToListAsync(cancellationToken);
    }
}
