using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class DiagnosticsController : ControllerBase
{
    private readonly OriginationDbContext _context;
    private readonly ILogger<DiagnosticsController> _logger;
    private readonly IWebHostEnvironment _env;

    public DiagnosticsController(OriginationDbContext context, ILogger<DiagnosticsController> logger, IWebHostEnvironment env)
    {
        _context = context;
        _logger = logger;
        _env = env;
    }

    [HttpGet("tables")]
    public async Task<IActionResult> GetTables()
    {
        if (!_env.IsDevelopment()) return NotFound();
        try
        {
            // Query the system tables to see what user tables exist
            var result = await _context.Database.SqlQueryRaw<TableInfo>(
                @"SELECT DB_NAME() as DatabaseName, TABLE_NAME as TableName
                  FROM INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_TYPE = 'BASE TABLE'
                  ORDER BY TABLE_NAME"
            ).ToListAsync();

            var dbName = result.FirstOrDefault()?.DatabaseName ?? "Unknown";
            var tables = result.Select(t => t.TableName).ToList();

            return Ok(new {
                Database = dbName,
                TableCount = tables.Count,
                Tables = tables
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving table list");
            return StatusCode(500, new { error = "An error occurred" });
        }
    }

    [HttpGet("tableschema/{tableName}")]
    public async Task<IActionResult> GetTableWithSchema(string tableName)
    {
        if (!_env.IsDevelopment()) return NotFound();
        try
        {
            var result = await _context.Database.SqlQueryRaw<TableSchemaInfo>(
                @"SELECT TABLE_SCHEMA as SchemaName, TABLE_NAME as TableName
                  FROM INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_NAME = {0} AND TABLE_TYPE = 'BASE TABLE'",
                tableName
            ).ToListAsync();

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving table schema for {TableName}", tableName);
            return StatusCode(500, new { error = "An error occurred" });
        }
    }

    [HttpGet("schema/{tableName}")]
    public async Task<IActionResult> GetTableSchema(string tableName)
    {
        if (!_env.IsDevelopment()) return NotFound();
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
            ).ToListAsync();

            return Ok(new {
                TableName = tableName,
                ColumnCount = columns.Count,
                Columns = columns
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving column schema for {TableName}", tableName);
            return StatusCode(500, new { error = "An error occurred" });
        }
    }

    private class TableInfo
    {
        public string DatabaseName { get; set; } = "";
        public string TableName { get; set; } = "";
    }

    private class TableSchemaInfo
    {
        public string SchemaName { get; set; } = "";
        public string TableName { get; set; } = "";
    }

    private class ColumnInfo
    {
        public string ColumnName { get; set; } = "";
        public string DataType { get; set; } = "";
        public string IsNullable { get; set; } = "";
        public int? MaxLength { get; set; }
        public string? DefaultValue { get; set; }
    }
}
