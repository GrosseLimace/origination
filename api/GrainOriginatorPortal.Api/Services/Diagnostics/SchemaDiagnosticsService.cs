// System namespaces
using System.Text.RegularExpressions;

// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Data;

namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Extracted verbatim from DiagnosticsController (audit finding
/// dotnet.diagnostics-controller-bypasses-service-layer). Raw INFORMATION_SCHEMA reads stay raw on
/// purpose: there is no entity for catalog views, and every table-name argument is both validated as
/// an identifier and passed as a SQL parameter, never concatenated.
/// </summary>
public sealed class SchemaDiagnosticsService : ISchemaDiagnosticsService
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly TradeUnitPreferencesDbContext _tuPrefContext;

    public SchemaDiagnosticsService(
        OriginationDbContext context,
        ApplicationDbContext appContext,
        TradeUnitPreferencesDbContext tuPrefContext)
    {
        _context = context;
        _appContext = appContext;
        _tuPrefContext = tuPrefContext;
    }

    // -------------------------------------------------------------------------
    public async Task<IReadOnlyList<object>> CheckConnectionsAsync()
    {
        static async Task<object> TestDb(DbContext db, string name, string testSql)
        {
            try
            {
                await db.Database.OpenConnectionAsync();
                var conn = db.Database.GetDbConnection();
                var dbName = conn.Database;
                string? result = null;
                using var cmd = conn.CreateCommand();
                cmd.CommandText = testSql;
                var raw = await cmd.ExecuteScalarAsync();
                result = raw?.ToString();
                return new { name, status = "OK", database = dbName, result };
            }
            catch (SqlException)
            {
                return new { name, status = "FAILED", message = "Database connection failed" };
            }
            catch (Exception)
            {
                return new { name, status = "FAILED", message = "Connection test failed" };
            }
        }

        // ODS tests must run sequentially — DbContext is not thread-safe
        var odsCustomers = await TestDb(_context, "ODS - vw_CurrentCustomers",
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA='originations' AND TABLE_NAME='vw_CurrentCustomers'");
        var odsPricing = await TestDb(_context, "ODS - vw_ContractPricing",
            "SELECT TOP 1 customer_id FROM originations.vw_ContractPricing");

        // Other contexts can run in parallel
        var otherResults = await Task.WhenAll(
            TestDb(_appContext, "Origination (OriginationConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProducerDetails'"),
            TestDb(_tuPrefContext, "TradeUnitPreferences (TradeUnitPreferencesConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'")
        );

        return new object[] { odsCustomers, odsPricing }.Concat(otherResults).ToList();
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Validates that tableName is a safe SQL identifier (letters, digits, underscores only).
    /// Throws ValidationException if the name contains characters that could indicate injection.
    /// security-guide.md §4.1 input validation.
    /// </summary>
    private static void ValidateTableName(string tableName)
    {
        if (!Regex.IsMatch(tableName, @"^[A-Za-z_][A-Za-z0-9_]*$"))
            throw new ValidationException("tableName", "tableName must contain only letters, digits, and underscores.");
    }

    // -------------------------------------------------------------------------
    public async Task<TableListResult> GetTablesAsync(CancellationToken cancellationToken)
    {
        var result = await _context.Database.SqlQueryRaw<TableInfo>(
            @"SELECT DB_NAME() as DatabaseName, TABLE_NAME as TableName
              FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_TYPE = 'BASE TABLE'
              ORDER BY TABLE_NAME"
        ).ToListAsync(cancellationToken);

        var dbName = result.FirstOrDefault()?.DatabaseName ?? "Unknown";
        var tables = result.Select(t => t.TableName).ToList();

        return new TableListResult(dbName, tables.Count, tables);
    }

    // -------------------------------------------------------------------------
    public async Task<List<TableSchemaInfo>> GetTableWithSchemaAsync(string tableName, CancellationToken cancellationToken)
    {
        ValidateTableName(tableName);

        var result = await _context.Database.SqlQueryRaw<TableSchemaInfo>(
            @"SELECT TABLE_SCHEMA as SchemaName, TABLE_NAME as TableName
              FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_NAME = {0} AND TABLE_TYPE = 'BASE TABLE'",
            tableName
        ).ToListAsync(cancellationToken);

        return result;
    }

    // -------------------------------------------------------------------------
    public async Task<TableColumnsResult> GetTableSchemaAsync(string tableName, CancellationToken cancellationToken)
    {
        ValidateTableName(tableName);

        var columns = await _context.Database.SqlQueryRaw<ColumnInfo>(
            @"SELECT
                COLUMN_NAME as ColumnName,
                DATA_TYPE as DataType,
                IS_NULLABLE as IsNullable,
                CHARACTER_MAXIMUM_LENGTH as MaxLength,
                COLUMN_DEFAULT as DefaultValue
              FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_NAME = {0}
              ORDER BY ORDINAL_POSITION",
            tableName
        ).ToListAsync(cancellationToken);

        return new TableColumnsResult(tableName, columns.Count, columns);
    }
}
