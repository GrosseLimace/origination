using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Controllers;

[AllowAnonymous]
[ApiController]
[Route("api/[controller]")]
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

    [HttpGet("connections")]
    public async Task<IActionResult> CheckConnections()
    {
        if (_env.IsProduction()) return NotFound();

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

        var results = await Task.WhenAll(
            TestDb(_context, "ODS (DefaultConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA='originations' AND TABLE_NAME='vw_CurrentCustomers'"),
            TestDb(_appContext, "Origination (OriginationConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProducerDetails'"),
            TestDb(_entContext, "Entitlements (EntitlementsConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'")
        );

        return Ok(results);
    }

    [HttpGet("tables")]
    public async Task<IActionResult> GetTables()
    {
        if (_env.IsProduction()) return NotFound();
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
        if (_env.IsProduction()) return NotFound();
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
        if (_env.IsProduction()) return NotFound();
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
