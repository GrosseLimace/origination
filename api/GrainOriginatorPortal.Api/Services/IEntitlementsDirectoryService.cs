namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Reads the entitlements directory (<c>vw_UserTradeUnitPreferences</c> in the TradeUnitPreferences
/// database) for the two pickers that list people, trade units and groups: the Daily Digest
/// recap-group editor (<c>EntitlementsController.GetCatalog</c>) and the note @-mention picker
/// (<c>NotesController.GetMentionCatalog</c>). Both used to run these queries inline.
///
/// Each controller still shapes and orders the rows itself, because the two lists differ on purpose
/// (the mention picker leaves out deactivated users, for one). Each also keeps its own fail-open
/// handling: these methods throw when the database cannot be reached.
/// </summary>
public interface IEntitlementsDirectoryService
{
    /// <summary>The caller's own rows: one per trade unit (and group) they are assigned to.
    /// <paramref name="userId"/> is the UPN prefix, as stored in the view.</summary>
    Task<List<DirectoryAssignment>> GetAssignmentsAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Every row for anyone assigned to at least one of the given trade units. With
    /// <paramref name="activeOnly"/>, people missing from <c>dbo.Users</c> or deactivated there are
    /// left out: a leaver can linger in the view after being deactivated.</summary>
    Task<List<DirectoryAssignment>> GetColleaguesAsync(
        IReadOnlyCollection<string> tradeUnitCodes, bool activeOnly, CancellationToken cancellationToken);

    /// <summary>Every row in the given groups, whoever it belongs to. Used to list each group's
    /// trade units, including ones the caller is not assigned to directly.</summary>
    Task<List<DirectoryAssignment>> GetGroupAssignmentsAsync(
        IReadOnlyCollection<int> groupIds, CancellationToken cancellationToken);
}

/// <summary>One row of <c>vw_UserTradeUnitPreferences</c>: a person assigned to a trade unit,
/// through a group when <see cref="GroupId"/> is set.</summary>
public sealed record DirectoryAssignment(
    string UserId,
    string DisplayName,
    string TradeUnitCode,
    string? Description,
    int? GroupId,
    string? GroupName);
