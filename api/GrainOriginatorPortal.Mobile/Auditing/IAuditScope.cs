namespace GrainOriginatorPortal.Mobile.Auditing;

/// <summary>
/// Per-request carrier for the before/after state of a mobile mutation. Controllers populate it;
/// <see cref="Filters.MobileAuditActionFilter"/> writes it to the audit log after the action runs
/// (SEC-ARCH-BURDI-001 §3.5: "log all data mutations with caller identity, timestamp, before/after values").
/// Registered as a scoped service.
/// </summary>
public interface IAuditScope
{
    string? EntityType { get; }
    object? EntityId { get; }
    string? BeforeJson { get; }
    string? AfterJson { get; }

    void Entity(string entityType, object? entityId);
    void Before<T>(T? state) where T : class;
    void After<T>(T? state) where T : class;
}
