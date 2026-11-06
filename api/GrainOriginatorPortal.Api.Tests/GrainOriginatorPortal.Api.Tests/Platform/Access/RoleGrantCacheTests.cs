// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

public class RoleGrantCacheTests
{
    private readonly ManualTimeProvider _time = new();
    private readonly FakeGrantRepository _repository = new();
    private readonly CapturingLogger<RoleGrantCache> _logger = new();
    private readonly RoleGrantCache _cache;

    public RoleGrantCacheTests()
    {
        var scopes = new ServiceCollection()
            .AddSingleton<IAccessGrantRepository>(_repository)
            .BuildServiceProvider()
            .GetRequiredService<IServiceScopeFactory>();
        _cache = new RoleGrantCache(scopes, new FixedOptionsMonitor<AccessOptions>(new AccessOptions()), _time, _logger);
    }

    [Fact]
    public async Task WithinTheCacheDuration_LoadsOnce()
    {
        await _cache.GetAsync(CancellationToken.None);
        _time.Advance(TimeSpan.FromMinutes(4));
        var grants = await _cache.GetAsync(CancellationToken.None);

        Assert.Equal(1, _repository.Loads);
        Assert.Equal(5, grants.Roles.Count);
    }

    [Fact]
    public async Task AfterTheCacheDuration_ReloadsSoAGrantChangeTakesEffect()
    {
        await _cache.GetAsync(CancellationToken.None);
        _repository.Rows = [TestGrants.Originator];
        _time.Advance(TimeSpan.FromMinutes(5));

        var grants = await _cache.GetAsync(CancellationToken.None);

        Assert.Equal(2, _repository.Loads);
        Assert.Equal("Originator", Assert.Single(grants.Roles).Key);
    }

    [Fact]
    public async Task AFailedReload_ServesTheLastCopy_AndRetriesAfter30Seconds()
    {
        await _cache.GetAsync(CancellationToken.None);
        _time.Advance(TimeSpan.FromMinutes(5));
        _repository.Failure = new InvalidOperationException("database unavailable");

        var stale = await _cache.GetAsync(CancellationToken.None);
        await _cache.GetAsync(CancellationToken.None);
        Assert.Equal(5, stale.Roles.Count);
        Assert.Equal(2, _repository.Loads); // the second call didn't retry yet
        Assert.Contains(_logger.Entries, e => Equals(e.Fields.GetValueOrDefault("ErrorCode"), "ACCESS_GRANTS_STALE"));

        _repository.Failure = null;
        _time.Advance(RoleGrantCache.RetryAfterFailure);
        await _cache.GetAsync(CancellationToken.None);
        Assert.Equal(3, _repository.Loads);
    }

    [Fact]
    public async Task AFailedFirstLoad_FailsClosedWithA503()
    {
        _repository.Failure = new InvalidOperationException("database unavailable");

        var error = await Assert.ThrowsAsync<InfrastructureException>(() => _cache.GetAsync(CancellationToken.None));

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, error.HttpStatusCode);
        Assert.Equal("ACCESS_GRANTS_UNAVAILABLE", error.ErrorCode);
    }

    [Fact]
    public async Task GrantsNamingUnknownPermissions_AreDroppedAndLogged()
    {
        _repository.Rows = [TestGrants.Role("Originator", "Persona", false, ["notes:read", "widgets:read"], [])];

        var grants = await _cache.GetAsync(CancellationToken.None);

        Assert.Equal(new[] { "notes:read" }, grants.Roles["Originator"].Permissions);
        var logged = _logger.Audit("ACCESS_UNKNOWN_PERMISSIONS");
        Assert.Equal(new[] { "widgets:read" }, (IEnumerable<string>)logged.Fields["Permissions"]!);
    }

    [Fact]
    public async Task WhileOneRequestReloads_OthersGetTheCurrentCopyWithoutWaiting()
    {
        await _cache.GetAsync(CancellationToken.None);
        _time.Advance(TimeSpan.FromMinutes(5));
        _repository.Gate = new TaskCompletionSource();

        var reloading = _cache.GetAsync(CancellationToken.None);
        var meanwhile = await _cache.GetAsync(CancellationToken.None);

        Assert.False(reloading.IsCompleted);
        Assert.Equal(5, meanwhile.Roles.Count);
        _repository.Gate.SetResult();
        await reloading;
        Assert.Equal(2, _repository.Loads);
    }

    [Fact]
    public async Task RoleNames_MatchWithoutRegardToCase()
    {
        var grants = await _cache.GetAsync(CancellationToken.None);

        Assert.True(grants.Roles.ContainsKey("originator"));
    }

    private sealed class FakeGrantRepository : IAccessGrantRepository
    {
        public IReadOnlyList<RoleGrants> Rows { get; set; } = TestGrants.All;
        public Exception? Failure { get; set; }
        public TaskCompletionSource? Gate { get; set; }
        public int Loads { get; private set; }

        public async Task<IReadOnlyList<RoleGrants>> GetAllAsync(CancellationToken cancellationToken)
        {
            Loads++;
            if (Gate is not null)
            {
                await Gate.Task;
            }

            return Failure is null ? Rows : throw Failure;
        }
    }
}
