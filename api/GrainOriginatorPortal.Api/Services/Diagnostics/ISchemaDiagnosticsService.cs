namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Database connectivity probes and INFORMATION_SCHEMA introspection behind the Dev/QA-only
/// diagnostics routes (<c>connections</c>, <c>tables</c>, <c>tableschema/{t}</c>, <c>schema/{t}</c>).
/// The environment gate stays in the controller; this service only answers the question.
/// </summary>
public interface ISchemaDiagnosticsService
{
    /// <summary>Tests connectivity to all three database contexts. One entry per probe; a probe that
    /// fails reports <c>status = "FAILED"</c> with a generic message rather than throwing.</summary>
    Task<IReadOnlyList<object>> CheckConnectionsAsync();

    /// <summary>Lists all user tables in the ODS database.</summary>
    Task<TableListResult> GetTablesAsync(CancellationToken cancellationToken);

    /// <summary>Gets schema/table info for a specific table name.</summary>
    /// <exception cref="Exceptions.ValidationException">The name is not a safe SQL identifier.</exception>
    Task<List<TableSchemaInfo>> GetTableWithSchemaAsync(string tableName, CancellationToken cancellationToken);

    /// <summary>Gets column definitions for a specific table.</summary>
    /// <exception cref="Exceptions.ValidationException">The name is not a safe SQL identifier.</exception>
    Task<TableColumnsResult> GetTableSchemaAsync(string tableName, CancellationToken cancellationToken);
}

public sealed record TableListResult(string Database, int TableCount, List<string> Tables);

public sealed record TableColumnsResult(string TableName, int ColumnCount, List<ColumnInfo> Columns);

public record TableInfo
{
    public string DatabaseName { get; init; } = "";
    public string TableName { get; init; } = "";
}

public record TableSchemaInfo
{
    public string SchemaName { get; init; } = "";
    public string TableName { get; init; } = "";
}

public record ColumnInfo
{
    public string ColumnName { get; init; } = "";
    public string DataType { get; init; } = "";
    public string IsNullable { get; init; } = "";
    public int? MaxLength { get; init; }
    public string? DefaultValue { get; init; }
}
