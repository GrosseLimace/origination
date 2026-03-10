// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Api.Data;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class DiagnosticsController : ControllerBase
{
    private readonly OriginationDbContext _context;
    private readonly ILogger<DiagnosticsController> _logger;

    public DiagnosticsController(OriginationDbContext context, ILogger<DiagnosticsController> logger)
    {
        _context = context;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Lists all user tables in the connected database.</summary>
    [HttpGet("tables")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetTables(CancellationToken cancellationToken = default)
    {
        try
        {
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
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving table list");
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = "An error occurred" });
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets schema/table info for a specific table name.</summary>
    [HttpGet("tableschema/{tableName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetTableWithSchema(string tableName, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _context.Database.SqlQueryRaw<TableSchemaInfo>(
                @"SELECT TABLE_SCHEMA as SchemaName, TABLE_NAME as TableName
                  FROM INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_NAME = {0} AND TABLE_TYPE = 'BASE TABLE'",
                tableName
            ).ToListAsync(cancellationToken);

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving table schema for {TableName}", tableName);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = "An error occurred" });
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets column definitions for a specific table.</summary>
    [HttpGet("schema/{tableName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetTableSchema(string tableName, CancellationToken cancellationToken = default)
    {
        try
        {
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
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving column schema for {TableName}", tableName);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = "An error occurred" });
        }
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
