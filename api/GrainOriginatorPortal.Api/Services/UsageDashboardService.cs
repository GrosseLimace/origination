using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class UsageDashboardService : IUsageDashboardService
{
    /// <summary>How long a resolved user universe stays cached. Short enough that an entitlements or
    /// group-membership change shows up promptly, long enough to cover one dashboard page load.</summary>
    private static readonly TimeSpan UniverseCacheTtl = TimeSpan.FromSeconds(60);

    private const string TotalSubFeature = "__total__";
    // Recency tiers for user status, measured in days since the user's last activity (all-time):
    // ≤7 → Active, 8–21 → At-risk, >21 → Dormant, none ever → Never.
    private const int ActiveWithinDays = 7;
    private const int AtRiskWithinDays = 21;
    // An Active user averaging fewer active days/week than this over the window is flagged "Light usage"
    // — recency-active but barely engaging. Weekends count as normal days here.
    private const double LightUsageActiveDaysPerWeek = 2.0;

    private static class UsageStatus
    {
        public const string Active = "Active";
        public const string AtRisk = "At-risk";
        public const string Dormant = "Dormant";
        public const string Never = "Never";
    }

    /// <summary>Per-user classification shared by the summary and the user list so their counts agree.</summary>
    private sealed record UserActivityClassification(
        string Status, DateTime? LastActive, double ActiveDaysPerWeek, bool IsLightUsage);

    private readonly IUsageRepository _repo;
    private readonly IAppAccessService _appAccess;
    private readonly IMemoryCache _cache;
    private readonly UsageUniverseCacheState _cacheState;

    public UsageDashboardService(
        IUsageRepository repo,
        IAppAccessService appAccess,
        IMemoryCache cache,
        UsageUniverseCacheState cacheState)
    {
        _repo = repo;
        _appAccess = appAccess;
        _cache = cache;
        _cacheState = cacheState;
    }

    /// <summary>
    /// Display labels for the features the dashboard reports on. Iterated to build the
    /// feature-sessions and underused-features lists, so a feature listed here shows up even with
    /// zero usage — which is the point for "underused", but also means a retired feature left in
    /// this map would render forever as a permanent zero.
    /// </summary>
    private static readonly Dictionary<string, string> FeatureLabels = new()
    {
        ["customers"] = "Customer Page",
        ["dashboard"] = "Planting Intention Dashboard",
        ["build-a-list"] = "Build a List",
        ["insights"] = "Actionable Insights",
        ["unshipped-bushels"] = "Unshipped Bushels",
        ["bidsheet"] = "Bid Sheet",
        ["daily-recap"] = "Daily Recap",
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Window handling
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// A requested date window, split into the part served by the daily rollups (closed days) and
    /// the part that must come from the raw tables (today, which no rollup has processed yet).
    /// </summary>
    private readonly record struct UsageWindow(
        DateTime FullFromUtc,
        DateTime FullToUtc,
        DateOnly RollupFrom,
        DateOnly RollupToExclusive,
        bool HasRollup,
        DateTime RawFromUtc,
        DateTime RawToUtc,
        bool HasRaw)
    {
        /// <summary>Whole days in the window; at least 1.</summary>
        public double TotalDays => Math.Max(1, (FullToUtc - FullFromUtc).TotalDays);
    }

    private static UsageWindow BuildWindow(DateOnly from, DateOnly to)
    {
        if (to < from) to = from;
        var toExclusive = to.AddDays(1);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Rollups cover closed days only.
        var rollupToExclusive = toExclusive < today ? toExclusive : today;
        // Raw tables cover today onward.
        var rawFrom = from > today ? from : today;

        return new UsageWindow(
            FullFromUtc: from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
            FullToUtc: toExclusive.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
            RollupFrom: from,
            RollupToExclusive: rollupToExclusive,
            HasRollup: rollupToExclusive > from,
            RawFromUtc: rawFrom.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
            RawToUtc: toExclusive.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
            HasRaw: toExclusive > rawFrom);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User universe
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Resolves the dashboard's user universe. When the Entra app-access set is available:
    /// "all users" (no trade-unit filter) = everyone who can actually sign in to the app, and a
    /// trade-unit filter narrows to that unit's entitled users who also have access. When the
    /// access set is unavailable (Graph blocked/misconfigured) this falls open to the full
    /// entitlements snapshot, so the dashboard never breaks on a Graph outage.
    /// <para>
    /// Cached for <see cref="UniverseCacheTtl"/> because one page load resolves this once per
    /// endpoint. See <see cref="UsageUniverseCacheState"/> for how exclusion edits invalidate it.
    /// </para>
    /// </summary>
    private async Task<HashSet<string>> GetUserIdSetAsync(string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var cacheKey = $"usage-dash:universe:{_cacheState.Generation}:{NormalizeTradeUnitKey(tradeUnitKey)}";
        if (_cache.TryGetValue(cacheKey, out HashSet<string>? cached) && cached is not null)
            return cached;

        var set = await ResolveUserIdSetAsync(tradeUnitKey, cancellationToken);

        // The shared IMemoryCache is registered with a SizeLimit, so every entry must declare a size.
        _cache.Set(cacheKey, set, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = UniverseCacheTtl,
            Size = 1
        });
        return set;
    }

    private async Task<HashSet<string>> ResolveUserIdSetAsync(string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var codes = string.IsNullOrWhiteSpace(tradeUnitKey)
            ? null
            : tradeUnitKey.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var access = await _appAccess.GetAccessSetAsync(cancellationToken);

        HashSet<string> set;
        if (codes is null && access.Available)
        {
            // "All users" = the access group itself — includes people with access but no
            // entitlements row (they'd be invisible to the snapshot), excludes entitled
            // people who can't sign in.
            set = new HashSet<string>(access.ShortNames, StringComparer.OrdinalIgnoreCase);
        }
        else
        {
            var ids = await _repo.GetSnapshotUserIdsAsync(codes, cancellationToken);
            set = new HashSet<string>(ids, StringComparer.OrdinalIgnoreCase);
            if (access.Available)
                set.IntersectWith(access.ShortNames);
        }

        // Drop the DB-managed excluded accounts (dbo.UsageDashboardExcludedUsers — IT/dev/admin
        // accounts whose activity would skew adoption) from every dashboard view. set uses
        // OrdinalIgnoreCase, so ExceptWith drops matches case-insensitively.
        var excluded = await _repo.GetExcludedUserIdsAsync(cancellationToken);
        if (excluded.Count > 0)
            set.ExceptWith(excluded);
        return set;
    }

    /// <summary>Canonicalizes the comma-separated trade-unit key so "A,B" and "b, a" share a cache entry.</summary>
    private static string NormalizeTradeUnitKey(string? tradeUnitKey)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey)) return "__all__";
        var codes = tradeUnitKey
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(c => c.ToUpperInvariant())
            .Distinct()
            .OrderBy(c => c, StringComparer.Ordinal);
        return string.Join(',', codes);
    }

    private async Task<Dictionary<string, string>> GetDisplayNameDictAsync(HashSet<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _repo.GetDisplayNamesAsync(userIds, cancellationToken);
        return rows
            .GroupBy(s => s.UserId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().DisplayName ?? string.Empty, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Combines rollup-derived and raw-derived per-user session stats. Login counts add; the average
    /// duration is re-weighted by login count so a 1-session day can't outweigh a 20-session week.
    /// </summary>
    private static List<UserSessionStats> MergeSessionStats(
        IEnumerable<UserSessionStats> first, IEnumerable<UserSessionStats> second)
    {
        return first.Concat(second)
            .GroupBy(s => s.UserId, StringComparer.OrdinalIgnoreCase)
            .Select(g =>
            {
                var logins = g.Sum(s => s.LoginCount);
                var minutes = g.Sum(s => s.AvgDuration * s.LoginCount);
                return new UserSessionStats(g.Key, logins, logins > 0 ? minutes / logins : 0);
            })
            .ToList();
    }

    /// <summary>Reads per-user session stats across the whole window, rollup for closed days + raw for today.</summary>
    private async Task<List<UserSessionStats>> GetWindowSessionStatsAsync(
        UsageWindow window, HashSet<string> userIds, CancellationToken cancellationToken)
    {
        var rollup = window.HasRollup
            ? await _repo.GetSessionStatsFromRollupAsync(window.RollupFrom, window.RollupToExclusive, userIds, cancellationToken)
            : [];
        var raw = window.HasRaw
            ? await _repo.GetSessionStatsByUserAsync(window.RawFromUtc, window.RawToUtc, userIds, cancellationToken)
            : [];
        return MergeSessionStats(rollup, raw);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User status classification (shared by summary + list)
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Classifies each user by recency and intensity. STATUS is a current snapshot off the user's
    /// all-time last activity (window-independent, so changing the date range doesn't move it): Active
    /// (≤7 days), At-risk (8–21), Dormant (&gt;21), Never (no recorded activity). ACTIVE-DAYS/WEEK is
    /// measured over the selected window (all 7 days count — a weekend login is real usage); an Active
    /// user below <see cref="LightUsageActiveDaysPerWeek"/> is flagged low-usage. Both the summary KPI
    /// and the user list read this, so they can't disagree.
    /// </summary>
    private async Task<Dictionary<string, UserActivityClassification>> ClassifyUsersAsync(
        HashSet<string> userIds, UsageWindow window, CancellationToken cancellationToken)
    {
        var lastActive = (await _repo.GetLastActiveByUserAsync(userIds, cancellationToken))
            .ToDictionary(a => a.UserId, a => a.LastActive, StringComparer.OrdinalIgnoreCase);

        // Active days in the window = rollup (closed days) + raw (current day); the two ranges are
        // disjoint by construction, so the counts sum cleanly.
        var activeDays = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        if (window.HasRollup)
            foreach (var c in await _repo.GetActiveDayCountsByUserFromRollupAsync(window.RollupFrom, window.RollupToExclusive, userIds, cancellationToken))
                activeDays[c.UserId] = activeDays.GetValueOrDefault(c.UserId) + c.Count;
        if (window.HasRaw)
            foreach (var c in await _repo.GetActiveDayCountsByUserAsync(window.RawFromUtc, window.RawToUtc, userIds, cancellationToken))
                activeDays[c.UserId] = activeDays.GetValueOrDefault(c.UserId) + c.Count;

        var weeks = Math.Max(1, window.TotalDays / 7.0);
        var today = DateTime.UtcNow.Date;

        var result = new Dictionary<string, UserActivityClassification>(StringComparer.OrdinalIgnoreCase);
        foreach (var userId in userIds)
        {
            var hasLast = lastActive.TryGetValue(userId, out var last);
            var perWeek = Math.Round(activeDays.GetValueOrDefault(userId) / weeks, 1);

            string status;
            if (!hasLast)
            {
                status = UsageStatus.Never;
            }
            else
            {
                // Whole-day recency avoids time-of-day / timezone noise, and users span time zones so
                // there's no single business timezone to anchor to — absolute UTC days are the fair basis.
                var daysSince = (today - last.Date).Days;
                status = daysSince <= ActiveWithinDays ? UsageStatus.Active
                    : daysSince <= AtRiskWithinDays ? UsageStatus.AtRisk
                    : UsageStatus.Dormant;
            }

            var isLight = status == UsageStatus.Active && perWeek < LightUsageActiveDaysPerWeek;
            result[userId] = new UserActivityClassification(status, hasLast ? last : null, perWeek, isLight);
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<UsageDashboardSummaryDto> GetSummaryAsync(DateOnly from, DateOnly to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var window = BuildWindow(from, to);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        var totalUsers = userIds.Count;

        // Same classifier the user list uses, so "Active Users" here == the count of Active rows there.
        var classification = await ClassifyUsersAsync(userIds, window, cancellationToken);
        var activeUsers = classification.Values.Count(c => c.Status == UsageStatus.Active);
        var atRiskUsers = classification.Values.Count(c => c.Status == UsageStatus.AtRisk);
        var dormantUsers = classification.Values.Count(c => c.Status == UsageStatus.Dormant);
        var neverUsers = classification.Values.Count(c => c.Status == UsageStatus.Never);
        var lightUsers = classification.Values.Count(c => c.IsLightUsage);
        var adoptionRate = totalUsers > 0 ? Math.Round((double)activeUsers / totalUsers * 100, 1) : 0;

        var sessionStats = await GetWindowSessionStatsAsync(window, userIds, cancellationToken);
        var withSessions = sessionStats.Where(s => s.LoginCount > 0).ToList();

        // Per *user* logins per week — the label says "Avg Logins / Week" for an originator, so it
        // has to be averaged over the people who logged in, not the whole org's session count.
        var weeks = Math.Max(1, window.TotalDays / 7.0);
        var avgLoginsPerWeek = withSessions.Count > 0
            ? Math.Round(withSessions.Average(s => s.LoginCount / weeks), 1)
            : 0;

        var totalLogins = withSessions.Sum(s => s.LoginCount);
        var totalMinutes = withSessions.Sum(s => s.AvgDuration * s.LoginCount);
        var avgSessionMinutes = totalLogins > 0 ? Math.Round(totalMinutes / totalLogins, 1) : 0;

        return new UsageDashboardSummaryDto
        {
            AdoptionRate = adoptionRate,
            AvgLoginsPerWeek = avgLoginsPerWeek,
            AvgSessionMinutes = avgSessionMinutes,
            TotalUsers = totalUsers,
            ActiveUsers = activeUsers,
            AtRiskUsers = atRiskUsers,
            DormantUsers = dormantUsers,
            NeverUsers = neverUsers,
            LightUsageUsers = lightUsers,
            NeedsAttentionCount = totalUsers - activeUsers
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Users table
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<List<UsageDashboardUserDto>> GetUsersAsync(DateOnly from, DateOnly to, string? tradeUnitKey, string? status, CancellationToken cancellationToken)
    {
        var window = BuildWindow(from, to);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        var displayNames = await GetDisplayNameDictAsync(userIds, cancellationToken);
        // Entra display names fill in for access-group members with no entitlements snapshot row
        // (e.g. admin accounts) — cached, so this is a dictionary lookup, not a Graph call.
        var accessNames = (await _appAccess.GetAccessSetAsync(cancellationToken)).DisplayNames;

        // Status + active-days/week come from the shared classifier (same basis as the summary KPIs).
        var classification = await ClassifyUsersAsync(userIds, window, cancellationToken);
        var sessionLookup = (await GetWindowSessionStatsAsync(window, userIds, cancellationToken))
            .ToDictionary(s => s.UserId, StringComparer.OrdinalIgnoreCase);
        var contactLookup = (await _repo.GetContactCountsByUserAsync(window.FullFromUtc, window.FullToUtc, userIds, cancellationToken))
            .ToDictionary(c => c.UserId, c => c.Count, StringComparer.OrdinalIgnoreCase);
        var notesLookup = (await _repo.GetNotesCreatedCountsByUserAsync(window.FullFromUtc, window.FullToUtc, userIds, cancellationToken))
            .ToDictionary(n => n.UserId, n => n.Count, StringComparer.OrdinalIgnoreCase);

        // Status filter accepts a status value (Active / At-risk / Dormant / Never) or the special
        // "light" value to isolate recency-active-but-low-usage accounts.
        var filter = status?.Trim();
        var filterAll = string.IsNullOrEmpty(filter) || string.Equals(filter, "all", StringComparison.OrdinalIgnoreCase);
        var filterLight = !filterAll && string.Equals(filter, "light", StringComparison.OrdinalIgnoreCase);

        var result = new List<UsageDashboardUserDto>();

        foreach (var userId in userIds)
        {
            var cls = classification[userId];
            var hasSession = sessionLookup.TryGetValue(userId, out var session);
            contactLookup.TryGetValue(userId, out var contactCount);
            notesLookup.TryGetValue(userId, out var noteCount);

            if (!filterAll)
            {
                if (filterLight) { if (!cls.IsLightUsage) continue; }
                else if (!string.Equals(filter, cls.Status, StringComparison.OrdinalIgnoreCase)) continue;
            }

            result.Add(new UsageDashboardUserDto
            {
                UserId = userId,
                DisplayName = displayNames.GetValueOrDefault(userId)
                    ?? accessNames.GetValueOrDefault(userId)
                    ?? userId,
                LoginCount = hasSession ? session!.LoginCount : 0,
                LastActive = cls.LastActive,
                AvgSessionMinutes = hasSession ? Math.Round(session!.AvgDuration, 1) : 0,
                Status = cls.Status,
                ActiveDaysPerWeek = cls.ActiveDaysPerWeek,
                IsLightUsage = cls.IsLightUsage,
                CustomersContacted = contactCount,
                NotesCreated = noteCount
            });
        }

        return result.OrderByDescending(u => u.LastActive ?? DateTime.MinValue).ToList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Daily active
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<List<DailyActiveDto>> GetDailyActiveAsync(DateOnly from, DateOnly to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var window = BuildWindow(from, to);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        var counts = new Dictionary<DateOnly, int>();
        if (window.HasRollup)
        {
            foreach (var day in await _repo.GetDailyActiveCountsFromRollupAsync(
                window.RollupFrom, window.RollupToExclusive, userIds, cancellationToken))
                counts[day.Date] = day.Count;
        }
        if (window.HasRaw)
        {
            foreach (var day in await _repo.GetDailyActiveCountsAsync(
                window.RawFromUtc, window.RawToUtc, userIds, cancellationToken))
                counts[day.Date] = day.Count;
        }

        // Gap-fill so the chart has a bar per day, including days nobody signed in.
        var result = new List<DailyActiveDto>();
        for (var d = DateOnly.FromDateTime(window.FullFromUtc); d < DateOnly.FromDateTime(window.FullToUtc); d = d.AddDays(1))
        {
            counts.TryGetValue(d, out var count);
            result.Add(new DailyActiveDto { Date = d.ToString("yyyy-MM-dd"), UniqueUserCount = count });
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Feature usage
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<List<FeatureSessionsDto>> GetFeatureSessionsAsync(DateOnly from, DateOnly to, string? tradeUnitKey, string? screen, CancellationToken cancellationToken)
    {
        var window = BuildWindow(from, to);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        var screenMinutes = await GetScreenMinutesByFeatureAsync(window, userIds, cancellationToken);
        var interactionCounts = await GetInteractionCountsAsync(window, userIds, screen, cancellationToken);

        if (string.IsNullOrWhiteSpace(screen) || screen == "all")
        {
            // Screen-time view. Features with no screen_enter events of their own — the calculators
            // are an overlay, Daily Recap is config — never appear here; they surface in the
            // per-screen interaction drill-down and in underused-features instead.
            return FeatureLabels
                .Select(fl => new FeatureSessionsDto
                {
                    FeatureCode = fl.Key,
                    FeatureLabel = fl.Value,
                    ScreenMinutes = (int)Math.Round(screenMinutes.GetValueOrDefault(fl.Key)),
                    SubFeatures = []
                })
                .Where(f => f.ScreenMinutes > 0)
                .OrderByDescending(f => f.ScreenMinutes)
                .ToList();
        }

        var subFeatures = interactionCounts
            .Where(c => string.Equals(c.FeatureCode, screen, StringComparison.OrdinalIgnoreCase)
                && c.SubFeatureCode is not null and not TotalSubFeature)
            .Select(c => new SubFeatureSessionDto
            {
                SubFeatureCode = c.SubFeatureCode!,
                Label = FormatSubFeatureLabel(c.SubFeatureCode!),
                InteractionCount = c.Count
            })
            .ToList();

        // Note creation is only visible through the middleware-tracked API call, not a click event.
        var notesCreateCounts = await _repo.GetNotesCreatedCountsByFeatureAsync(
            window.FullFromUtc, window.FullToUtc, userIds, cancellationToken);
        var notesCount = notesCreateCounts
            .FirstOrDefault(n => string.Equals(n.FeatureCode, screen, StringComparison.OrdinalIgnoreCase))?.Count ?? 0;
        if (notesCount > 0)
        {
            var existing = subFeatures.FirstOrDefault(sf => sf.SubFeatureCode == "notes-create");
            if (existing is not null) existing.InteractionCount += notesCount;
            else subFeatures.Add(new SubFeatureSessionDto
            {
                SubFeatureCode = "notes-create",
                Label = "Notes Created",
                InteractionCount = notesCount
            });
        }

        return
        [
            new FeatureSessionsDto
            {
                FeatureCode = screen,
                FeatureLabel = FeatureLabels.GetValueOrDefault(screen, screen),
                ScreenMinutes = (int)Math.Round(screenMinutes.GetValueOrDefault(screen)),
                SubFeatures = subFeatures.OrderByDescending(sf => sf.InteractionCount).ToList()
            }
        ];
    }

    /// <summary>
    /// Minutes per feature across the window: rollup for closed days, live derivation for today.
    /// <para>
    /// Note the rollup necessarily computes each day independently, so a day boundary ends a screen
    /// visit — the same way any other gap over the cap does. Historical numbers therefore include
    /// one trailing minute per user per active day, where a single live pass over a multi-day window
    /// would only credit the final event. The rollup's reading is the more defensible one.
    /// </para>
    /// </summary>
    private async Task<Dictionary<string, double>> GetScreenMinutesByFeatureAsync(
        UsageWindow window, HashSet<string> userIds, CancellationToken cancellationToken)
    {
        var totals = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);

        if (window.HasRollup)
        {
            foreach (var row in await _repo.GetFeatureScreenTimeFromRollupAsync(
                window.RollupFrom, window.RollupToExclusive, userIds, cancellationToken))
                totals[row.FeatureCode] = totals.GetValueOrDefault(row.FeatureCode) + row.Minutes;
        }

        if (window.HasRaw)
        {
            var events = await _repo.GetScreenEnterEventsAsync(window.RawFromUtc, window.RawToUtc, userIds, cancellationToken);
            foreach (var (featureCode, minutes) in ScreenTimeCalculator.MinutesByFeature(events))
                totals[featureCode] = totals.GetValueOrDefault(featureCode) + minutes;
        }

        return totals;
    }

    private async Task<List<FeatureSubFeatureCount>> GetInteractionCountsAsync(
        UsageWindow window, HashSet<string> userIds, string? screen, CancellationToken cancellationToken)
    {
        var rollup = window.HasRollup
            ? await _repo.GetInteractionCountsFromRollupAsync(window.RollupFrom, window.RollupToExclusive, userIds, screen, cancellationToken)
            : [];
        var raw = window.HasRaw
            ? await _repo.GetInteractionCountsAsync(window.RawFromUtc, window.RawToUtc, userIds, screen, cancellationToken)
            : [];

        return rollup.Concat(raw)
            .GroupBy(c => (c.FeatureCode, c.SubFeatureCode))
            .Select(g => new FeatureSubFeatureCount(g.Key.FeatureCode, g.Key.SubFeatureCode, g.Sum(c => c.Count)))
            .ToList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Weekly trend
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<List<WeeklyTrendDto>> GetWeeklyTrendAsync(string? tradeUnitKey, int weeks, CancellationToken cancellationToken)
    {
        weeks = Math.Clamp(weeks, 1, 52);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var currentWeekStart = StartOfWeek(today);
        var firstWeekStart = currentWeekStart.AddDays(-7 * (weeks - 1));

        var byWeek = new Dictionary<DateOnly, WeeklyTrendDto>();

        // Closed weeks come from the weekly rollup.
        foreach (var row in await _repo.GetWeeklyLoginRollupAsync(firstWeekStart, userIds, cancellationToken))
        {
            if (row.WeekStart >= currentWeekStart) continue; // recomputed live below
            byWeek[row.WeekStart] = new WeeklyTrendDto
            {
                WeekStart = row.WeekStart.ToString("yyyy-MM-dd"),
                ActiveUsers = row.ActiveUsers,
                TotalSessions = row.SessionCount
            };
        }

        // The in-progress week has no rollup row yet.
        var currentWindow = BuildWindow(currentWeekStart, today);
        var currentStats = await GetWindowSessionStatsAsync(currentWindow, userIds, cancellationToken);
        byWeek[currentWeekStart] = new WeeklyTrendDto
        {
            WeekStart = currentWeekStart.ToString("yyyy-MM-dd"),
            ActiveUsers = currentStats.Count(s => s.LoginCount > 0),
            TotalSessions = currentStats.Sum(s => s.LoginCount)
        };

        // Gap-fill so a quiet week renders as an empty bar rather than disappearing.
        var result = new List<WeeklyTrendDto>();
        for (var w = firstWeekStart; w <= currentWeekStart; w = w.AddDays(7))
        {
            result.Add(byWeek.TryGetValue(w, out var dto)
                ? dto
                : new WeeklyTrendDto { WeekStart = w.ToString("yyyy-MM-dd"), ActiveUsers = 0, TotalSessions = 0 });
        }
        return result;
    }

    private static DateOnly StartOfWeek(DateOnly date)
    {
        var offset = ((int)date.DayOfWeek + 6) % 7; // Monday = 0
        return date.AddDays(-offset);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Activity breakdown
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<List<ActivityBreakdownDto>> GetActivityBreakdownAsync(DateOnly from, DateOnly to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        // Reads the raw tables for the whole window: the profiles/contracts columns are
        // distinct-by-producer across the entire range, which per-day rollups cannot reconstruct.
        var window = BuildWindow(from, to);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        var displayNames = await GetDisplayNameDictAsync(userIds, cancellationToken);

        var activityMap = (await _repo.GetActivityBreakdownByUserAsync(window.FullFromUtc, window.FullToUtc, userIds, cancellationToken))
            .ToDictionary(a => a.UserId, StringComparer.OrdinalIgnoreCase);
        var clicksMap = (await _repo.GetClickBreakdownByUserAsync(window.FullFromUtc, window.FullToUtc, userIds, cancellationToken))
            .ToDictionary(c => c.UserId, StringComparer.OrdinalIgnoreCase);

        var allUserIds = activityMap.Keys.Union(clicksMap.Keys, StringComparer.OrdinalIgnoreCase).ToList();

        return allUserIds.Select(id =>
        {
            activityMap.TryGetValue(id, out var a);
            clicksMap.TryGetValue(id, out var c);
            return new ActivityBreakdownDto
            {
                UserId = id,
                DisplayName = displayNames.GetValueOrDefault(id, id),
                ProfilesViewed = c?.ProfilesViewed ?? 0,
                ContractsViewed = c?.ContractsViewed ?? 0,
                NotesTaken = a?.NotesTaken ?? 0,
                CallsEmails = c?.CallsEmails ?? 0,
                ListsBuilt = c?.ListsBuilt ?? 0,
                PlantingIntentionsAdded = a?.PlantingIntentionsAdded ?? 0,
                ProducerDetails = c?.ProducerDetails ?? 0
            };
        })
        .OrderByDescending(d => d.ProfilesViewed + d.ContractsViewed + d.NotesTaken + d.CallsEmails
            + d.ListsBuilt + d.PlantingIntentionsAdded + d.ProducerDetails)
        .ToList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Underused features
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<List<UnderusedFeatureDto>> GetUnderusedFeaturesAsync(DateOnly from, DateOnly to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        // Measured in distinct users, and now honors the trade-unit filter and the excluded-users
        // list — the old per-feature-only rollup had no user dimension, so it could do neither.
        var window = BuildWindow(from, to);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        // Union the (feature, user) pairs from both sources rather than adding their counts, so a
        // user who was active both earlier in the window and today is still one user.
        var usersByFeature = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        void Record(IEnumerable<FeatureUser> pairs)
        {
            foreach (var pair in pairs)
            {
                if (!usersByFeature.TryGetValue(pair.FeatureCode, out var users))
                    usersByFeature[pair.FeatureCode] = users = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                users.Add(pair.UserId);
            }
        }

        if (window.HasRollup)
            Record(await _repo.GetFeatureUsersFromRollupAsync(window.RollupFrom, window.RollupToExclusive, userIds, cancellationToken));
        if (window.HasRaw)
            Record(await _repo.GetFeatureUsersAsync(window.RawFromUtc, window.RawToUtc, userIds, cancellationToken));

        return FeatureLabels
            .Select(fl => new UnderusedFeatureDto
            {
                FeatureCode = fl.Key,
                FeatureName = fl.Value,
                UniqueUsers = usersByFeature.TryGetValue(fl.Key, out var users) ? users.Count : 0
            })
            .OrderBy(f => f.UniqueUsers)
            .ToList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Query library
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<List<QueryLibraryUsageDto>> GetQueryLibraryUsageAsync(DateOnly from, DateOnly to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var window = BuildWindow(from, to);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        var rawUsage = await _repo.GetLibraryQueryUsageAsync(window.FullFromUtc, window.FullToUtc, userIds, cancellationToken);

        var ids = rawUsage
            .Select(r => int.TryParse(r.TargetId, out var id) ? id : 0)
            .Where(id => id > 0)
            .ToList();
        var names = await _repo.GetQueryLibraryNamesAsync(ids, cancellationToken);

        return rawUsage.Select(r => new QueryLibraryUsageDto
        {
            QueryText = names.TryGetValue(r.TargetId, out var name) ? name : $"Query #{r.TargetId}",
            TimesUsed = r.Count
        }).ToList();
    }

    /// <inheritdoc />
    public async Task<List<QuerySearchGapDto>> GetQuerySearchGapsAsync(DateOnly from, DateOnly to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var window = BuildWindow(from, to);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        var gaps = await _repo.GetQuerySearchGapsAsync(window.FullFromUtc, window.FullToUtc, userIds, cancellationToken);
        return gaps.Select(g => new QuerySearchGapDto { SearchText = g.SearchText, TimesSearched = g.TimesSearched }).ToList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Per-user drill-down
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<UserUsageDetailDto?> GetUserDetailAsync(string userId, DateOnly from, DateOnly to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var window = BuildWindow(from, to);

        var allowedIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        if (!allowedIds.Contains(userId))
            return null;

        var displayNames = await GetDisplayNameDictAsync(
            new HashSet<string>([userId], StringComparer.OrdinalIgnoreCase), cancellationToken);
        var displayName = displayNames.GetValueOrDefault(userId, userId);

        var sessionDurations = await _repo.GetSessionDurationsForUserAsync(userId, window.FullFromUtc, window.FullToUtc, cancellationToken);
        var loginCount = sessionDurations.Count;
        var totalMinutes = sessionDurations.Sum(d => (double)d);
        var avgMinutes = loginCount > 0 ? totalMinutes / loginCount : 0;

        // Same classifier as the summary and the user list, so the badge here can't disagree with
        // the tier the admin clicked through from (and last-active spans rollup history, not just
        // the raw-retention window).
        var classification = await ClassifyUsersAsync(
            new HashSet<string>([userId], StringComparer.OrdinalIgnoreCase), window, cancellationToken);
        var cls = classification[userId];
        var lastActive = cls.LastActive;
        var status = cls.Status;

        var clicks = await _repo.GetClicksForUserAsync(userId, window.FullFromUtc, window.FullToUtc, cancellationToken);
        var activities = await _repo.GetActivitiesForUserAsync(userId, window.FullFromUtc, window.FullToUtc, cancellationToken);

        // One pass to bucket clicks, so the ~40 engagement numbers below are dictionary lookups
        // rather than 40 more scans of the same list.
        var clickTally = new ClickTally(clicks);

        var screenEnters = clicks
            .Where(c => c.EventType == "screen_enter")
            .Select(c => new ScreenEnterEvent(userId, c.FeatureCode, c.Timestamp))
            .ToList();
        var minutesByDayAndFeature = ScreenTimeCalculator.MinutesByDayAndFeature(screenEnters);

        var screenMinutesPerDay = minutesByDayAndFeature
            .GroupBy(kv => kv.Key.Date)
            .ToDictionary(g => g.Key, g => g.Sum(kv => kv.Value));
        var timePerFeature = minutesByDayAndFeature
            .GroupBy(kv => kv.Key.FeatureCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Sum(kv => kv.Value), StringComparer.OrdinalIgnoreCase);

        var dailyEventCounts = clicks
            .GroupBy(c => c.Timestamp.Date)
            .ToDictionary(g => g.Key, g => g.Count());

        var dailyActivity = new List<UserDailyActivityDto>();
        for (var d = DateOnly.FromDateTime(window.FullFromUtc); d < DateOnly.FromDateTime(window.FullToUtc); d = d.AddDays(1))
        {
            var dt = d.ToDateTime(TimeOnly.MinValue);
            dailyEventCounts.TryGetValue(dt, out var count);
            screenMinutesPerDay.TryGetValue(dt, out var mins);
            dailyActivity.Add(new UserDailyActivityDto
            {
                Date = d.ToString("yyyy-MM-dd"),
                EventCount = count,
                ScreenMinutes = Math.Round(mins, 1)
            });
        }

        var topProducer = await ResolveTopProducerAsync(clicks, cancellationToken);

        var customers = new CustomerEngagementDto
        {
            ProfilesViewed = clickTally.DistinctTargets("customers", "profile-opened", "interaction"),
            ContractsExpanded = clickTally.DistinctTargets("customers", "contracts", "interaction"),
            CallsClicked = clickTally.CountByEventType("call_click"),
            EmailsClicked = clickTally.CountByEventType("email_click"),
            // The note lifecycle is visible through the API calls the middleware records, so these
            // come from activity rows rather than duplicating the same events as client-side clicks.
            NotesCreated = activities.Count(a => a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST"),
            NotesEdited = activities.Count(a => a.SubFeatureCode == "notes-edit"),
            NotesDeleted = activities.Count(a => a.SubFeatureCode == "notes-delete"),
            NotesPinned = activities.Count(a => a.SubFeatureCode == "notes-pin"),
            // Choosing an @mention is a pure client action with no request behind it.
            MentionsUsed = clickTally.Count("customers", "notes-mention"),
            PlantingIntentionsAdded = activities.Count(a => a.SubFeatureCode == "planting-intentions" && a.HttpMethod == "POST"),
            ProducerDetailsEdited = clickTally.Count("customers", "producer-details"),
            TicketDropdownOpens = clickTally.Count("customers", "tickets"),
            StorageDropdownOpens = clickTally.Count("customers", "storage"),
            PlantingTabClicks = clickTally.Count("customers", "planting-intentions"),
            TopProducer = topProducer,
        };

        var topQueryCounts = clicks
            .Where(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "library-query-selected" && c.TargetId != null)
            .GroupBy(c => c.TargetId!)
            .Select(g => new { QueryId = g.Key, Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .Take(5)
            .ToList();

        var topQueryIds = topQueryCounts
            .Select(q => int.TryParse(q.QueryId, out var id) ? id : 0)
            .Where(id => id > 0)
            .ToList();
        var topQueryNames = await _repo.GetQueryLibraryNamesAsync(topQueryIds, cancellationToken);

        var buildList = new BuildListEngagementDto
        {
            ListsSaved = clickTally.Count("build-a-list", "save-list"),
            ListsLoaded = clickTally.Count("build-a-list", "saved-list-loaded"),
            ListsDeleted = clickTally.Count("build-a-list", "saved-list-deleted"),
            LibraryPromptsClicked = clickTally.Count("build-a-list", "library-query-selected"),
            LibrarySearchNoMatch = clickTally.Count("build-a-list", "library-search-no-match"),
            QueryRequestsSubmitted = clickTally.Count("build-a-list", "query-request-submitted"),
            MembersAdded = clickTally.Count("build-a-list", "member-added"),
            MembersExcluded = clickTally.Count("build-a-list", "member-excluded"),
            RefineFiltersOpens = clickTally.Count("build-a-list", "refine-filters"),
            ManageMembersOpens = clickTally.Count("build-a-list", "manage-members"),
            TopLibraryQueries = topQueryCounts.Select(q => new TopLibraryQueryDto
            {
                QueryName = topQueryNames.TryGetValue(q.QueryId, out var name) ? name : $"Query #{q.QueryId}",
                TimesUsed = q.Count
            }).ToList()
        };

        var knownInsightCats = new HashSet<string>(
            ["unconfirmed-contracts", "spot-loads", "unshipped-bushels"], StringComparer.OrdinalIgnoreCase);
        var insights = new InsightsEngagementDto
        {
            UnconfirmedContractsClicks = clickTally.Count("insights", "unconfirmed-contracts"),
            SpotLoadsClicks = clickTally.Count("insights", "spot-loads"),
            UnshippedBushelsClicks = clickTally.Count("insights", "unshipped-bushels"),
            OtherCategoryClicks = clicks.Count(c => c.FeatureCode == "insights"
                && c.SubFeatureCode is not null
                && !knownInsightCats.Contains(c.SubFeatureCode)),
            UnshippedSearches = clickTally.CountByFeaturePrefix("unshipped-bushels", "search-"),
            UnshippedGroupsExpanded = clickTally.Count("unshipped-bushels", "group-expanded"),
        };

        var locationEditGroups = clicks
            .Where(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "bids-changed" && !string.IsNullOrEmpty(c.TargetId))
            .GroupBy(c => c.TargetId!)
            .Select(g => new TopBidLocationDto { LocationName = g.Key, EditCount = g.Count() })
            .OrderByDescending(g => g.EditCount)
            .ToList();

        var bidSheet = new BidSheetEngagementDto
        {
            LocationsAdded = clickTally.Count("bidsheet", "locations-added"),
            LocationsDeleted = clickTally.Count("bidsheet", "location-deleted"),
            LocationsSelected = clickTally.Count("bidsheet", "location-selected"),
            CommoditiesAdded = clickTally.Count("bidsheet", "commodities-added"),
            BidsChanged = clickTally.Count("bidsheet", "bids-changed"),
            EditBidsOpens = clickTally.Count("bidsheet", "edit-bids-opened"),
            ReferenceSet = clickTally.Count("bidsheet", "reference-set"),
            MostEditedLocation = locationEditGroups.FirstOrDefault(),
            TopEditedLocations = locationEditGroups.Take(5).ToList(),
        };

        var plantingDash = new PlantingDashEngagementDto
        {
            ByCropTabClicks = clickTally.Count("dashboard", "by-crop"),
            ProducersTabClicks = clickTally.Count("dashboard", "producers-and-intentions"),
            HarvestContractsTabClicks = clickTally.Count("dashboard", "harvest-contracts"),
            ProducerRowClicks = clickTally.Count("dashboard", "producer-row-click"),
            SeasonTargetsSaved = clickTally.Count("dashboard", "set-season-targets"),
        };

        // Recap-group edits all go through the API, so the middleware sees them; only the page visit
        // itself needs a client-side event.
        var dailyRecap = new DailyRecapEngagementDto
        {
            GroupsCreated = activities.Count(a => a.SubFeatureCode == "group-created"),
            GroupsUpdated = activities.Count(a => a.SubFeatureCode == "group-edited"),
            GroupsDeleted = activities.Count(a => a.SubFeatureCode == "group-deleted"),
            EnableToggles = activities.Count(a => a.SubFeatureCode == "group-toggled"),
            ScreenVisits = clicks.Count(c => c.FeatureCode == "daily-recap" && c.EventType == "screen_enter"),
        };

        var timePerScreen = FeatureLabels
            .Select(fl => new ScreenTimeDto
            {
                FeatureCode = fl.Key,
                FeatureLabel = fl.Value,
                Minutes = (int)Math.Round(timePerFeature.GetValueOrDefault(fl.Key))
            })
            .Where(s => s.Minutes > 0)
            .OrderByDescending(s => s.Minutes)
            .ToList();

        var recentActivity = clicks
            .OrderByDescending(c => c.Timestamp)
            .Take(50)
            .Select(c => new RecentActivityDto
            {
                Timestamp = c.Timestamp,
                EventType = c.EventType,
                FeatureCode = c.FeatureCode,
                SubFeatureCode = c.SubFeatureCode,
                TargetId = c.TargetId,
                TargetName = null,
            })
            .ToList();

        await ResolveTargetNamesAsync(recentActivity, cancellationToken);

        return new UserUsageDetailDto
        {
            UserId = userId,
            DisplayName = displayName,
            Status = status,
            LastActive = lastActive,
            LoginCount = loginCount,
            AvgSessionMinutes = Math.Round(avgMinutes, 1),
            TotalAppMinutes = Math.Round(totalMinutes, 1),
            CustomersContactedCount = clickTally.CountByEventType("call_click") + clickTally.CountByEventType("email_click"),
            DailyActivity = dailyActivity,
            Customers = customers,
            BuildList = buildList,
            Insights = insights,
            BidSheet = bidSheet,
            PlantingDashboard = plantingDash,
            DailyRecap = dailyRecap,
            TimePerScreen = timePerScreen,
            RecentActivity = recentActivity
        };
    }

    private async Task<TopProducerDto?> ResolveTopProducerAsync(List<UserClickRow> clicks, CancellationToken cancellationToken)
    {
        var customerInteractionSubFeatures = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "profile-opened", "customer-details", "producer-details", "tickets", "storage"
        };

        var top = clicks
            .Where(c => c.TargetId != null && long.TryParse(c.TargetId, out _) &&
                ((c.FeatureCode == "customers" && c.SubFeatureCode != null && customerInteractionSubFeatures.Contains(c.SubFeatureCode))
                 || c.EventType == "call_click" || c.EventType == "email_click"))
            .GroupBy(c => c.TargetId!)
            .Select(g => new { CustomerId = long.Parse(g.Key), Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .FirstOrDefault();

        if (top is null) return null;

        var snap = await _repo.GetCustomerNameAsync(top.CustomerId, cancellationToken);
        return snap is null ? null : new TopProducerDto
        {
            CustomerId = top.CustomerId,
            CustomerName = snap.Name,
            ScoularId = snap.ScoularId,
            InteractionCount = top.Count,
        };
    }

    /// <summary>
    /// Fills in <see cref="RecentActivityDto.TargetName"/>. Resolution is keyed on the row's own
    /// feature/sub-feature, not on "whichever lookup happens to contain this id" — a customer id and
    /// a query-library id can be the same number, and a first-match-wins pass mislabels one of them.
    /// </summary>
    private async Task ResolveTargetNamesAsync(List<RecentActivityDto> rows, CancellationToken cancellationToken)
    {
        static bool IsCustomerTarget(RecentActivityDto r)
        {
            var customerSubFeatures = CustomerTargetSubFeatures;
            return (r.FeatureCode == "customers"
                    && (r.SubFeatureCode is null || customerSubFeatures.Contains(r.SubFeatureCode))
                    && r.SubFeatureCode != "contracts")
                || (r.FeatureCode == "insights" && r.SubFeatureCode is not null && customerSubFeatures.Contains(r.SubFeatureCode))
                || (r.FeatureCode == "unshipped-bushels" && r.SubFeatureCode == "group-expanded")
                || (r.FeatureCode == "dashboard" && r.SubFeatureCode == "producer-row-click")
                || (r.FeatureCode == "build-a-list" && r.SubFeatureCode is "member-added" or "member-excluded");
        }

        static bool IsContractTarget(RecentActivityDto r) =>
            r.FeatureCode == "customers" && r.SubFeatureCode == "contracts";

        static bool IsLibraryTarget(RecentActivityDto r) =>
            r.FeatureCode == "build-a-list" && r.SubFeatureCode == "library-query-selected";

        var customerIds = rows.Where(r => IsCustomerTarget(r) && long.TryParse(r.TargetId, out _))
            .Select(r => long.Parse(r.TargetId!)).Distinct().ToList();
        var contractIds = rows.Where(r => IsContractTarget(r) && long.TryParse(r.TargetId, out _))
            .Select(r => long.Parse(r.TargetId!)).Distinct().ToList();
        var libraryIds = rows.Where(r => IsLibraryTarget(r) && int.TryParse(r.TargetId, out _))
            .Select(r => int.Parse(r.TargetId!)).Distinct().ToList();

        var customerNames = await _repo.GetCustomerDisplayNamesAsync(customerIds, cancellationToken);
        var contractNames = await _repo.GetContractDisplayNamesAsync(contractIds, cancellationToken);
        var libraryNames = await _repo.GetQueryLibraryNamesAsync(libraryIds, cancellationToken);

        foreach (var row in rows)
        {
            if (row.TargetId is null) continue;

            if (IsCustomerTarget(row) && customerNames.TryGetValue(row.TargetId, out var custName))
                row.TargetName = custName;
            else if (IsContractTarget(row) && contractNames.TryGetValue(row.TargetId, out var ctName))
                row.TargetName = ctName;
            else if (IsLibraryTarget(row) && libraryNames.TryGetValue(row.TargetId, out var libName))
                row.TargetName = libName;
        }
    }

    private static readonly HashSet<string> CustomerTargetSubFeatures = new(StringComparer.OrdinalIgnoreCase)
    {
        "profile-opened", "customer-details", "producer-details",
        "tickets", "storage", "planting-intentions", "contracts",
        "trade-unit-assignment", "notes-edit", "notes-delete", "notes-pin", "notes-unpin",
        "member-added", "member-excluded", "producer-row-click",
        "unconfirmed-contracts", "spot-loads", "unshipped-bushels",
    };

    /// <summary>
    /// Buckets one user's click events once so the drill-down's engagement numbers are lookups.
    /// </summary>
    private sealed class ClickTally
    {
        private readonly Dictionary<(string Feature, string SubFeature), int> _byFeatureSub = new();
        private readonly Dictionary<(string Feature, string SubFeature), HashSet<string?>> _targetsByFeatureSub = new();
        private readonly Dictionary<string, int> _byEventType = new(StringComparer.OrdinalIgnoreCase);
        private readonly List<(string Feature, string SubFeature)> _keys = [];

        public ClickTally(IEnumerable<UserClickRow> clicks)
        {
            foreach (var c in clicks)
            {
                _byEventType[c.EventType] = _byEventType.GetValueOrDefault(c.EventType) + 1;

                if (c.SubFeatureCode is null) continue;
                var key = (c.FeatureCode, c.SubFeatureCode);
                if (!_byFeatureSub.ContainsKey(key)) _keys.Add(key);
                _byFeatureSub[key] = _byFeatureSub.GetValueOrDefault(key) + 1;

                if (c.EventType == "interaction")
                {
                    if (!_targetsByFeatureSub.TryGetValue(key, out var targets))
                        _targetsByFeatureSub[key] = targets = [];
                    targets.Add(c.TargetId);
                }
            }
        }

        public int Count(string feature, string subFeature) => _byFeatureSub.GetValueOrDefault((feature, subFeature));

        public int CountByEventType(string eventType) => _byEventType.GetValueOrDefault(eventType);

        public int DistinctTargets(string feature, string subFeature, string eventType) =>
            eventType == "interaction" && _targetsByFeatureSub.TryGetValue((feature, subFeature), out var targets)
                ? targets.Count
                : 0;

        /// <summary>Sums every sub-feature of <paramref name="feature"/> whose code starts with the prefix.</summary>
        public int CountByFeaturePrefix(string feature, string subFeaturePrefix) =>
            _keys
                .Where(k => string.Equals(k.Feature, feature, StringComparison.OrdinalIgnoreCase)
                    && k.SubFeature.StartsWith(subFeaturePrefix, StringComparison.OrdinalIgnoreCase))
                .Sum(k => _byFeatureSub[k]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Excluded-users administration
    // ─────────────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<AccessUsersDto> GetAccessUsersAsync(CancellationToken cancellationToken)
    {
        // Same universe the dashboard filters on: enabled members of the Entra access group, keyed by
        // short name. When Graph can't be read the set is Unavailable → the picker falls back to free text.
        var set = await _appAccess.GetAccessSetAsync(cancellationToken);
        if (!set.Available)
            return new AccessUsersDto { Available = false, Users = [] };

        var users = set.DisplayNames
            .Select(kv => new AccessUserDto { UserId = kv.Key, DisplayName = kv.Value })
            .OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return new AccessUsersDto { Available = true, Users = users };
    }

    /// <inheritdoc />
    public async Task<List<ExcludedUserDto>> GetExcludedUsersAsync(CancellationToken cancellationToken)
    {
        var rows = await _repo.GetExcludedUsersAsync(cancellationToken);
        if (rows.Count == 0) return [];

        var names = await GetDisplayNameDictAsync(
            new HashSet<string>(rows.Select(r => r.UserId), StringComparer.OrdinalIgnoreCase), cancellationToken);

        return rows.Select(r => new ExcludedUserDto
        {
            Id = r.Id,
            UserId = r.UserId,
            DisplayName = names.GetValueOrDefault(r.UserId),
            Reason = r.Reason,
            CreatedBy = r.CreatedBy,
            CreatedAt = r.CreatedAt
        }).ToList();
    }

    /// <inheritdoc />
    public async Task<ExcludedUserDto?> AddExcludedUserAsync(string userId, string? reason, string createdBy, CancellationToken cancellationToken)
    {
        var normalized = NormalizeUserId(userId);
        var row = await _repo.AddExcludedUserAsync(normalized, reason, createdBy, cancellationToken);
        if (row is null) return null;

        // Every dashboard view filters on this list, so drop the cached universes immediately
        // instead of showing unchanged numbers until the TTL lapses.
        _cacheState.Invalidate();

        return new ExcludedUserDto
        {
            Id = row.Id,
            UserId = row.UserId,
            Reason = row.Reason,
            CreatedBy = row.CreatedBy,
            CreatedAt = row.CreatedAt
        };
    }

    /// <inheritdoc />
    public async Task<bool> RemoveExcludedUserAsync(int id, CancellationToken cancellationToken)
    {
        var removed = await _repo.RemoveExcludedUserAsync(id, cancellationToken);
        if (removed) _cacheState.Invalidate();
        return removed;
    }

    /// <summary>Activity is recorded under the short name (UPN before the '@'), so exclusions have
    /// to be stored the same way for the case-insensitive set subtraction to match.</summary>
    private static string NormalizeUserId(string userId)
    {
        var trimmed = (userId ?? string.Empty).Trim();
        var at = trimmed.IndexOf('@');
        return at > 0 ? trimmed[..at] : trimmed;
    }

    private static string FormatSubFeatureLabel(string subFeatureCode)
    {
        return string.Join(' ', subFeatureCode
            .Replace('-', ' ')
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(w => char.ToUpperInvariant(w[0]) + w[1..]));
    }
}
