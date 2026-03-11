// System namespaces
using System.Text.RegularExpressions;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;

// Project namespaces
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Controllers;

[AllowAnonymous]
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class DiagnosticsController : ControllerBase
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly EntitlementsDbContext _entContext;
    private readonly ILogger<DiagnosticsController> _logger;
    private readonly IWebHostEnvironment _env;

    public DiagnosticsController(
        OriginationDbContext context,
        ApplicationDbContext appContext,
        EntitlementsDbContext entContext,
        ILogger<DiagnosticsController> logger,
        IWebHostEnvironment env)
    {
        _context = context;
        _appContext = appContext;
        _entContext = entContext;
        _logger = logger;
        _env = env;
    }

    // -------------------------------------------------------------------------
    /// <summary>Tests connectivity to all three database contexts. Dev/QA only.</summary>
    [HttpGet("connections")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> CheckConnections()
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

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
            catch (SqlException ex)
            {
                return new { name, status = "FAILED", errorNumber = ex.Number, errorState = ex.State, message = ex.Message };
            }
            catch (Exception ex)
            {
                return new { name, status = "FAILED", errorNumber = (int?)null, errorState = (byte?)null, message = ex.Message };
            }
        }

        // ODS tests must run sequentially — DbContext is not thread-safe
        var odsCustomers = await TestDb(_context, "ODS - vw_CurrentCustomers",
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA='originations' AND TABLE_NAME='vw_CurrentCustomers'");
        var odsPricing = await TestDb(_context, "ODS - vw_ContractPricing",
            "SELECT TOP 1 customer_id FROM originations.vw_ContractPricing");

        // Other contexts can run in parallel
        var otherResults = await Task.WhenAll(
            TestDb(_appContext, "Origination (DefaultConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProducerDetails'"),
            TestDb(_entContext, "Entitlements (EntitlementsConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'")
        );

        return Ok(new object[] { odsCustomers, odsPricing }.Concat(otherResults));
    }

    // -------------------------------------------------------------------------
    /// <summary>Returns 404 in non-development environments.</summary>
    /// <remarks>
    /// These endpoints expose internal DB schema structure and must never be
    /// accessible in production. security-guide.md §4.3 (least privilege).
    /// </remarks>
    private IActionResult? DenyIfNotDevelopment()
        => _env.IsDevelopment() ? null : NotFound();

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
    /// <summary>Lists all user tables in the connected database.</summary>
    [HttpGet("tables")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTables(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        var result = await _context.Database.SqlQueryRaw<TableInfo>(
            @"SELECT DB_NAME() as DatabaseName, TABLE_NAME as TableName
              FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_TYPE = 'BASE TABLE'
              ORDER BY TABLE_NAME"
        ).ToListAsync(cancellationToken);

        var dbName = result.FirstOrDefault()?.DatabaseName ?? "Unknown";
        var tables = result.Select(t => t.TableName).ToList();

        return Ok(new { Database = dbName, TableCount = tables.Count, Tables = tables });
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets schema/table info for a specific table name.</summary>
    [HttpGet("tableschema/{tableName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTableWithSchema(string tableName, CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;
        ValidateTableName(tableName);

        var result = await _context.Database.SqlQueryRaw<TableSchemaInfo>(
            @"SELECT TABLE_SCHEMA as SchemaName, TABLE_NAME as TableName
              FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_NAME = {0} AND TABLE_TYPE = 'BASE TABLE'",
            tableName
        ).ToListAsync(cancellationToken);

        return Ok(result);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets column definitions for a specific table.</summary>
    [HttpGet("schema/{tableName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTableSchema(string tableName, CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;
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

        return Ok(new { TableName = tableName, ColumnCount = columns.Count, Columns = columns });
    }

    // -------------------------------------------------------------------------
    private record TableInfo
    {
        public string DatabaseName { get; init; } = "";
        public string TableName { get; init; } = "";
    }

    private record TableSchemaInfo
    {
        public string SchemaName { get; init; } = "";
        public string TableName { get; init; } = "";
    }

    private record ColumnInfo
    {
        public string ColumnName { get; init; } = "";
        public string DataType { get; init; } = "";
        public string IsNullable { get; init; } = "";
        public int? MaxLength { get; init; }
        public string? DefaultValue { get; init; }
    }
}
