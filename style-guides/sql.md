# SQL Style Guide

A comprehensive guide to SQL database design and query writing for Azure SQL Database and SQL Server projects.

---

## Table of Contents

1. [Naming Conventions](#naming-conventions)
2. [Schema Design](#schema-design)
3. [Query Formatting](#query-formatting)
4. [Performance Best Practices](#performance-best-practices)
5. [Security Considerations](#security-considerations)
6. [Migration Standards](#migration-standards)
7. [Azure SQL Specific](#azure-sql-specific)
8. [References](#references)

---

## Naming Conventions

### General Rules

1. **Use PascalCase** for all object names (tables, columns, constraints, indexes)
2. **Be descriptive** - names should be self-documenting
3. **Avoid abbreviations** unless universally understood (Id, Url, etc.)
4. **Use singular nouns** for table names (User, not Users)
5. **Avoid reserved words** - don't name columns `Order`, `User`, `Date`
6. **Maximum 128 characters** - SQL Server limit, but aim for much shorter

### Tables

| Pattern | Example | Notes |
|---------|---------|-------|
| Entity name (singular) | `Customer`, `Order`, `Product` | Main entities |
| Junction tables | `CustomerOrder`, `ProductCategory` | For many-to-many |
| Lookup/reference tables | `OrderStatus`, `PaymentType` | Prefix with parent or use descriptive name |
| Audit tables | `CustomerAudit`, `OrderHistory` | Suffix with purpose |

```sql
-- Good
CREATE TABLE Customer (...)
CREATE TABLE OrderItem (...)
CREATE TABLE CustomerAddress (...)

-- Bad
CREATE TABLE tblCustomers (...)      -- Hungarian notation
CREATE TABLE cust (...)              -- Abbreviation
CREATE TABLE customer_addresses (...) -- snake_case
```

### Columns

| Pattern | Example | Notes |
|---------|---------|-------|
| Primary key | `Id` or `CustomerId` | Prefer `Id` for simplicity |
| Foreign key | `CustomerId`, `OrderId` | Match referenced table + `Id` |
| Boolean | `IsActive`, `HasChildren` | Prefix with `Is`, `Has`, `Can` |
| Date/time | `CreatedAt`, `ModifiedAt`, `OrderDate` | Use `At` suffix for timestamps |
| Count/quantity | `Quantity`, `ItemCount` | Use `Count` suffix for counts |
| Amount/money | `TotalAmount`, `UnitPrice` | Be specific about what it represents |

```sql
-- Good
CREATE TABLE Customer (
    Id INT PRIMARY KEY,
    FirstName NVARCHAR(100),
    LastName NVARCHAR(100),
    Email NVARCHAR(255),
    IsActive BIT DEFAULT 1,
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    ModifiedAt DATETIME2
);

-- Bad
CREATE TABLE Customer (
    CustomerID INT,           -- Inconsistent casing
    first_name NVARCHAR(100), -- snake_case
    lname NVARCHAR(100),      -- Abbreviation
    active BIT,               -- Missing Is prefix
    created DATETIME          -- Ambiguous
);
```

### Indexes

| Type | Pattern | Example |
|------|---------|---------|
| Primary key | `PK_TableName` | `PK_Customer` |
| Foreign key | `FK_ChildTable_ParentTable` | `FK_Order_Customer` |
| Unique | `UQ_TableName_Column(s)` | `UQ_Customer_Email` |
| Non-clustered | `IX_TableName_Column(s)` | `IX_Order_CustomerId` |
| Covering index | `IX_TableName_Column(s)_INCL` | `IX_Order_CustomerId_INCL` |

```sql
-- Primary key
ALTER TABLE Customer
ADD CONSTRAINT PK_Customer PRIMARY KEY (Id);

-- Foreign key
ALTER TABLE [Order]
ADD CONSTRAINT FK_Order_Customer
FOREIGN KEY (CustomerId) REFERENCES Customer(Id);

-- Unique constraint
ALTER TABLE Customer
ADD CONSTRAINT UQ_Customer_Email UNIQUE (Email);

-- Index
CREATE NONCLUSTERED INDEX IX_Order_CustomerId
ON [Order] (CustomerId);

-- Covering index
CREATE NONCLUSTERED INDEX IX_Order_CustomerId_INCL
ON [Order] (CustomerId)
INCLUDE (OrderDate, TotalAmount);
```

### Stored Procedures and Functions

| Type | Pattern | Example |
|------|---------|---------|
| Stored procedure | `usp_Action_Entity` | `usp_Get_CustomerOrders` |
| Table-valued function | `fn_Get_EntityName` | `fn_Get_ActiveCustomers` |
| Scalar function | `fn_Calculate_Something` | `fn_Calculate_OrderTotal` |

```sql
-- Stored procedure
CREATE PROCEDURE usp_Get_CustomerById
    @CustomerId INT
AS
BEGIN
    -- Implementation
END;

-- Table-valued function
CREATE FUNCTION fn_Get_CustomerOrders(@CustomerId INT)
RETURNS TABLE
AS
RETURN (
    SELECT * FROM [Order] WHERE CustomerId = @CustomerId
);
```

---

## Schema Design

### Data Types

Choose the smallest appropriate data type:

| Use Case | Recommended Type | Notes |
|----------|------------------|-------|
| Primary key | `INT` or `BIGINT` | `INT` for most cases (2B rows) |
| GUID/UUID | `UNIQUEIDENTIFIER` | Only when truly needed |
| Short text (<100 chars) | `NVARCHAR(n)` | Use specific length |
| Long text | `NVARCHAR(MAX)` | For variable-length content |
| Fixed text (codes) | `CHAR(n)` or `NCHAR(n)` | Country codes, status codes |
| Boolean | `BIT` | Not `INT` or `TINYINT` |
| Money | `DECIMAL(19,4)` | Not `MONEY` type |
| Date only | `DATE` | Not `DATETIME` |
| Date + time | `DATETIME2(3)` | Millisecond precision usually sufficient |
| UTC timestamp | `DATETIME2` | Store in UTC, convert in app |

**Hard rules:**

- Do **not** use `VARCHAR`, `NVARCHAR`, or other text types for surrogate primary keys or foreign keys.
- Use `INT` for most surrogate keys, `BIGINT` only when row growth justifies it, and `UNIQUEIDENTIFIER` only when a distributed/global identifier is truly required.
- If a foreign key references a parent key, the child column must match the parent key's type exactly, including length, precision, and scale where applicable.
- Do not use `NVARCHAR(MAX)` or other large object types unless the actual use case requires it.
- Be explicit about string lengths. Avoid default-length or "just make it 4000" habits.

```sql
-- Good type choices
CREATE TABLE Product (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Sku CHAR(10) NOT NULL,              -- Fixed-length code
    Name NVARCHAR(200) NOT NULL,         -- Variable text
    Description NVARCHAR(MAX),           -- Long text
    UnitPrice DECIMAL(19,4) NOT NULL,    -- Money
    IsAvailable BIT DEFAULT 1,           -- Boolean
    LaunchDate DATE,                     -- Date only
    CreatedAt DATETIME2(3) DEFAULT GETUTCDATE()
);
```

```sql
-- Bad type choices
CREATE TABLE Customer (
    Id NVARCHAR(50) PRIMARY KEY,         -- Text surrogate key
    Status NVARCHAR(4000),               -- Unbounded-ish without justification
    TotalAmount FLOAT,                   -- Approximate numeric for money
    CreatedAt DATETIME                   -- Less precise than DATETIME2
);
```

### Nullable Columns

- **Default to NOT NULL** - make columns nullable only when needed
- **Document why** nullable columns are nullable
- Consider default values instead of NULL where appropriate

```sql
-- Good: explicit about nullability
CREATE TABLE Customer (
    Id INT NOT NULL PRIMARY KEY,
    Email NVARCHAR(255) NOT NULL,           -- Required
    Phone NVARCHAR(20) NULL,                -- Optional
    MiddleName NVARCHAR(100) NULL,          -- Not everyone has one
    IsActive BIT NOT NULL DEFAULT 1         -- Default instead of NULL
);
```

### Primary Keys

- **Use surrogate keys** (`INT IDENTITY`) for most tables
- **Natural keys** only when truly immutable and unique
- **Composite keys** only for junction tables
- Every table should have a primary key unless there is a very specific, documented reason not to
- With few exceptions, every table should also have a clustered index
- If you use a natural key, document why it is immutable and operationally safer than a surrogate key

```sql
-- Surrogate key (preferred)
CREATE TABLE Customer (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Email NVARCHAR(255) NOT NULL UNIQUE
);

-- Junction table with composite key
CREATE TABLE CustomerRole (
    CustomerId INT NOT NULL,
    RoleId INT NOT NULL,
    AssignedAt DATETIME2 DEFAULT GETUTCDATE(),
    PRIMARY KEY (CustomerId, RoleId),
    FOREIGN KEY (CustomerId) REFERENCES Customer(Id),
    FOREIGN KEY (RoleId) REFERENCES Role(Id)
);
```

### Foreign Keys and Referential Integrity

- **Always define foreign keys** - even if application validates
- **Consider cascade behavior** carefully
- **Index foreign key columns** - critical for join performance
- Foreign keys do **not** automatically create supporting indexes; add them intentionally
- Match parent and child key definitions exactly; mismatched types create conversion risk and poor plans
- Use `NOT NULL` on foreign key columns unless the relationship is genuinely optional

```sql
-- Foreign key with index
ALTER TABLE [Order]
ADD CONSTRAINT FK_Order_Customer
FOREIGN KEY (CustomerId) REFERENCES Customer(Id)
ON DELETE NO ACTION  -- Explicit about behavior
ON UPDATE NO ACTION;

CREATE INDEX IX_Order_CustomerId ON [Order](CustomerId);
```

| Cascade Option | When to Use |
|----------------|-------------|
| `NO ACTION` | Default; application handles |
| `CASCADE` | Child records should be deleted with parent |
| `SET NULL` | Clear reference but keep record |
| `SET DEFAULT` | Reset to default value |

### Audit Columns

Include standard audit columns on all tables:

```sql
CREATE TABLE Customer (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    -- Business columns here

    -- Audit columns
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CreatedBy NVARCHAR(100) NOT NULL,
    ModifiedAt DATETIME2 NULL,
    ModifiedBy NVARCHAR(100) NULL
);
```

---

## Query Formatting

### General Rules

1. **UPPERCASE keywords** - `SELECT`, `FROM`, `WHERE`, `JOIN`
2. **Lowercase identifiers** - or match your table/column casing
3. **One clause per line** for complex queries
4. **Consistent indentation** - 4 spaces
5. **Explicit column lists** - avoid `SELECT *`
6. **Table aliases** - use meaningful short names

```rule
id: sql-no-select-star
source: sql.md§Query-Formatting
severity: error
description: Queries must enumerate columns; SELECT * is not allowed (except inside EXISTS subqueries)
applies-to: [changed-files]
files: ['*.sql', '*.cs']
tool: grep-forbidden
args:
  pattern: 'SELECT[[:space:]]+\*[[:space:]]+FROM'
  ignore-case: true
  except: 'EXISTS[[:space:]]*\([[:space:]]*SELECT'
message: |
  Enumerate the columns instead of using SELECT *. The only allowed use of
  SELECT * is inside an EXISTS(...) subquery where columns are immaterial.
  See dev-standards/style-guides/sql.md §Query-Formatting.
```

```rule
id: sql-no-string-interpolated-query
source: sql.md / security.md
severity: error
description: SQL must not be built via C# string interpolation. The pattern requires a SQL keyword followed by a SQL-context anchor (FROM / INTO / SET) so it doesn't fire on exception-message strings that merely contain words like "Delete".
applies-to: [changed-files]
files: ['*.cs']
tool: grep-forbidden
args:
  pattern: '\$"[^"]*((SELECT\b[^"]+FROM\b)|(INSERT\b[^"]+INTO\b)|(UPDATE\b[^"]+SET\b)|(DELETE\b[^"]+FROM\b)|(MERGE\b[^"]+INTO\b)|(EXEC(UTE)?\b[[:space:]]+[a-zA-Z_]))[^"]*\{[^"]*\}'
  ignore-case: true
message: |
  Use parameterized queries (sp_executesql parameters, EF Core LINQ,
  Dapper named parameters, FromSqlInterpolated). String interpolation
  into SQL is an injection vector.
```

```rule
id: sql-no-fromsqlraw-interpolation
source: sql.md / security.md
severity: error
description: FromSqlRaw must not receive an interpolated string; use FromSqlInterpolated instead
applies-to: [changed-files]
files: ['*.cs']
tool: grep-forbidden
args:
  pattern: 'FromSqlRaw[[:space:]]*\([[:space:]]*\$"'
  ignore-case: true
message: |
  Switch FromSqlRaw($"...") to FromSqlInterpolated($"..."). FromSqlRaw
  with interpolation evaluates the C# expression before the SQL is
  parameterized — same injection risk as concatenation.
```

### SELECT Statements

```sql
-- Simple query
SELECT Id, FirstName, LastName, Email
FROM Customer
WHERE IsActive = 1;

-- Complex query with proper formatting
SELECT
    c.Id AS CustomerId,
    c.FirstName,
    c.LastName,
    o.Id AS OrderId,
    o.OrderDate,
    o.TotalAmount
FROM Customer c
INNER JOIN [Order] o ON c.Id = o.CustomerId
LEFT JOIN OrderStatus os ON o.StatusId = os.Id
WHERE c.IsActive = 1
    AND o.OrderDate >= @StartDate
    AND o.OrderDate < @EndDate
ORDER BY o.OrderDate DESC, c.LastName ASC;
```

### JOIN Formatting

```sql
-- Good: explicit JOIN syntax
SELECT c.Name, o.OrderDate
FROM Customer c
INNER JOIN [Order] o ON c.Id = o.CustomerId
LEFT JOIN Shipper s ON o.ShipperId = s.Id;

-- Bad: implicit join (comma-separated)
SELECT c.Name, o.OrderDate
FROM Customer c, [Order] o
WHERE c.Id = o.CustomerId;  -- Don't use this style
```

### WHERE Clauses

```sql
-- Multiple conditions - each on its own line
SELECT *
FROM [Order]
WHERE CustomerId = @CustomerId
    AND OrderDate >= @StartDate
    AND OrderDate < @EndDate
    AND StatusId IN (1, 2, 3)
    AND TotalAmount > 0;

-- Complex conditions - use parentheses
SELECT *
FROM Customer
WHERE IsActive = 1
    AND (
        Email LIKE '%@company.com'
        OR Department = 'Sales'
    );
```

### INSERT Statements

```sql
-- Explicit column list (required)
INSERT INTO Customer (FirstName, LastName, Email, CreatedBy)
VALUES ('John', 'Doe', 'john@example.com', @CurrentUser);

-- Multiple rows
INSERT INTO OrderStatus (Name, Description)
VALUES
    ('Pending', 'Order received'),
    ('Processing', 'Order being prepared'),
    ('Shipped', 'Order shipped'),
    ('Delivered', 'Order delivered');
```

### UPDATE Statements

```sql
-- Always include WHERE clause
UPDATE Customer
SET
    Email = @NewEmail,
    ModifiedAt = GETUTCDATE(),
    ModifiedBy = @CurrentUser
WHERE Id = @CustomerId;

-- Never run UPDATE without WHERE in production
-- Consider using transactions for safety
BEGIN TRANSACTION;
    UPDATE Customer SET IsActive = 0 WHERE LastLoginDate < @CutoffDate;
    -- Verify row count before committing
    IF @@ROWCOUNT > @ExpectedMax
        ROLLBACK;
    ELSE
        COMMIT;
```

### DELETE Statements

```sql
-- Prefer soft deletes
UPDATE Customer
SET
    IsDeleted = 1,
    DeletedAt = GETUTCDATE(),
    DeletedBy = @CurrentUser
WHERE Id = @CustomerId;

-- Hard delete when necessary
DELETE FROM CustomerSession
WHERE ExpiresAt < GETUTCDATE();
```

---

## Performance Best Practices

### Indexing Strategy

**When to create indexes:**
- Primary key columns (automatic)
- Foreign key columns (always)
- Columns used in WHERE clauses frequently
- Columns used in ORDER BY
- Columns used in JOIN conditions

**Hard rules:**

- Review every new table for its clustered index strategy. Do not leave tables as heaps by accident.
- Every foreign key column should have a supporting index unless an existing composite index already covers the workload.
- Do not create indexes mechanically on every column; index for real query patterns and maintenance cost.
- Review missing-index recommendations before applying them. They are suggestions, not automatic truth.
- Check for obvious AI-generated anti-patterns: missing join indexes, duplicate indexes, or indexes that do not match actual predicates and sort order.

**Covering indexes** - include columns to avoid key lookups:

```sql
-- Query that benefits from covering index
SELECT CustomerId, OrderDate, TotalAmount
FROM [Order]
WHERE CustomerId = @CustomerId
ORDER BY OrderDate DESC;

-- Covering index for this query
CREATE NONCLUSTERED INDEX IX_Order_CustomerId_INCL
ON [Order] (CustomerId, OrderDate DESC)
INCLUDE (TotalAmount);
```

### Query Optimization

**Avoid functions on indexed columns:**

```sql
-- Bad: function prevents index use
SELECT * FROM Customer
WHERE YEAR(CreatedAt) = 2024;

-- Good: range query uses index
SELECT * FROM Customer
WHERE CreatedAt >= '2024-01-01'
    AND CreatedAt < '2025-01-01';
```

**Use EXISTS instead of IN for subqueries:**

```sql
-- Good: EXISTS
SELECT c.*
FROM Customer c
WHERE EXISTS (
    SELECT 1 FROM [Order] o
    WHERE o.CustomerId = c.Id
        AND o.OrderDate >= @RecentDate
);

-- Less efficient for large sets: IN
SELECT c.*
FROM Customer c
WHERE c.Id IN (
    SELECT CustomerId FROM [Order]
    WHERE OrderDate >= @RecentDate
);
```

**Parameterized queries:**

```sql
-- Good: parameterized (plan reuse, SQL injection prevention)
EXEC sp_executesql
    N'SELECT * FROM Customer WHERE Email = @Email',
    N'@Email NVARCHAR(255)',
    @Email = @InputEmail;

-- Bad: dynamic SQL with concatenation
SET @SQL = 'SELECT * FROM Customer WHERE Email = ''' + @InputEmail + '''';
```

### Batch Operations

```sql
-- Process large updates in batches
DECLARE @BatchSize INT = 1000;
DECLARE @RowsAffected INT = @BatchSize;

WHILE @RowsAffected = @BatchSize
BEGIN
    UPDATE TOP (@BatchSize) Customer
    SET IsActive = 0
    WHERE LastLoginDate < @CutoffDate
        AND IsActive = 1;

    SET @RowsAffected = @@ROWCOUNT;

    -- Allow other transactions
    WAITFOR DELAY '00:00:00.100';
END;
```

---

## Security Considerations

### Parameterized Queries (Mandatory)

**Never concatenate user input into SQL:**

```sql
-- NEVER do this
SET @SQL = 'SELECT * FROM Customer WHERE Id = ' + @UserInput;

-- Always use parameters
SELECT * FROM Customer WHERE Id = @CustomerId;
```

### Least Privilege

- **Application accounts** should have minimal permissions
- **Separate read/write roles** where appropriate
- **No direct table access** - use stored procedures or views

```sql
-- Create role with minimal permissions
CREATE ROLE AppReader;
GRANT SELECT ON Customer TO AppReader;
GRANT SELECT ON [Order] TO AppReader;

CREATE ROLE AppWriter;
GRANT INSERT, UPDATE ON Customer TO AppWriter;
GRANT INSERT, UPDATE ON [Order] TO AppWriter;

-- Don't grant DELETE unless necessary
```

### Row-Level Security (Azure SQL)

```sql
-- Security predicate function
CREATE FUNCTION dbo.fn_SecurityPredicate(@TenantId INT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS Result
WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS INT);

-- Apply security policy
CREATE SECURITY POLICY TenantFilter
ADD FILTER PREDICATE dbo.fn_SecurityPredicate(TenantId) ON dbo.Customer;
```

### Sensitive Data

```sql
-- Dynamic data masking
ALTER TABLE Customer
ALTER COLUMN Email ADD MASKED WITH (FUNCTION = 'email()');

ALTER TABLE Customer
ALTER COLUMN Phone ADD MASKED WITH (FUNCTION = 'partial(0,"XXX-XXX-",4)');

-- Always Encrypted for highly sensitive data
-- Configure in application connection string
```

---

## Migration Standards

### File Naming

```
YYYYMMDD_HHMMSS_Description.sql
```

Examples:
- `20240115_143000_CreateCustomerTable.sql`
- `20240116_090000_AddOrderStatusColumn.sql`
- `20240120_120000_CreateOrderIndexes.sql`

### Migration Script Template

```sql
-- Migration: 20240115_143000_CreateCustomerTable
-- Author: [Name]
-- Description: Creates the Customer table with audit columns
-- Rollback: DROP TABLE Customer

-- Pre-check
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Customer')
BEGIN
    CREATE TABLE Customer (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Email NVARCHAR(255) NOT NULL,
        FirstName NVARCHAR(100) NOT NULL,
        LastName NVARCHAR(100) NOT NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CreatedBy NVARCHAR(100) NOT NULL,
        ModifiedAt DATETIME2 NULL,
        ModifiedBy NVARCHAR(100) NULL
    );

    CREATE UNIQUE INDEX UQ_Customer_Email ON Customer(Email);

    PRINT 'Created Customer table';
END
ELSE
BEGIN
    PRINT 'Customer table already exists - skipping';
END
GO
```

### Idempotent Migrations

All migrations should be re-runnable without error:

```sql
-- Adding a column (idempotent)
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('Customer') AND name = 'MiddleName'
)
BEGIN
    ALTER TABLE Customer ADD MiddleName NVARCHAR(100) NULL;
END

-- Adding an index (idempotent)
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE object_id = OBJECT_ID('Order') AND name = 'IX_Order_CustomerId'
)
BEGIN
    CREATE INDEX IX_Order_CustomerId ON [Order](CustomerId);
END
```

### Migrations Must Parse Before Merge

Every `.sql` file must parse against the SQL Server grammar. A migration with a
syntax error is not caught by review, by a build, or by a unit test — the first
thing that evaluates it is the deployment itself, and by then it fails in every
environment at once.

Migration runners stop on the first failure, so one bad script blocks every
later one. A runner using per-script transactions makes this worse: earlier
scripts in the same run commit and are journaled while the bad one rolls back
unjournaled, leaving that environment on a **partially applied** migration set
that no longer matches any other environment.

Do not rely on a SQL linter for this. Linters that reimplement the T-SQL grammar
accept statements the engine rejects. The case this rule exists for:

```sql
-- Invalid: THROW takes a literal or a variable, never an expression.
-- sqlfluff 4.2.2 (dialect tsql) reports ZERO unparsable segments here.
;THROW 50000, LEFT(@msg, 2044), 1;

-- Valid: hoist the expression into a variable first.
DECLARE @ThrowMsg NVARCHAR(2048) = LEFT(@msg, 2044);
THROW 50000, @ThrowMsg, 1;
```

The gate therefore parses with Microsoft's ScriptDom — the same grammar the
engine uses — rather than a linter. Reproduce a failure locally before pushing:

```powershell
pwsh -File dev-standards/tools/tsql-parse.ps1 <scriptdom.dll> path/to/script.sql
```

```rule
id: sql-must-parse
source: sql.md§Migration-Standards
severity: error
description: Every changed .sql file must parse against the SQL Server grammar (ScriptDom)
applies-to: [changed-files]
files: ['*.sql']
tool: tsql-parse
args:
  sql-version: '160'
message: |
  This file does not parse against the SQL Server grammar, so it will fail at
  deployment time rather than in review. Fix the reported line before merging —
  a migration runner stops on the first failing script and, with per-script
  transactions, leaves the environment partially applied.
  See dev-standards/style-guides/sql.md §Migration-Standards.
```

---

## Azure SQL Specific

### Connection Resiliency

- Use **retry logic** for transient failures
- Configure **connection timeout** appropriately
- Use **connection pooling**

### Performance Tiers

| Tier | Use Case |
|------|----------|
| Basic | Dev/test, light workloads |
| Standard | Most production workloads |
| Premium | High I/O, in-memory OLTP |
| Hyperscale | Very large databases, rapid scale |
| Serverless | Variable, unpredictable workloads |

### Query Store

Enable Query Store for performance monitoring:

```sql
-- Check Query Store status
SELECT actual_state_desc, desired_state_desc
FROM sys.database_query_store_options;

-- Find top resource-consuming queries
SELECT TOP 10
    qt.query_sql_text,
    rs.avg_cpu_time,
    rs.avg_logical_io_reads
FROM sys.query_store_query_text qt
JOIN sys.query_store_query q ON qt.query_text_id = q.query_text_id
JOIN sys.query_store_plan p ON q.query_id = p.query_id
JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
ORDER BY rs.avg_cpu_time DESC;
```

### Monitoring

```sql
-- Current executing queries
SELECT
    r.session_id,
    r.status,
    r.command,
    t.text AS query_text,
    r.cpu_time,
    r.total_elapsed_time
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id > 50;

-- Index usage statistics
SELECT
    OBJECT_NAME(i.object_id) AS TableName,
    i.name AS IndexName,
    s.user_seeks,
    s.user_scans,
    s.user_lookups,
    s.user_updates
FROM sys.indexes i
JOIN sys.dm_db_index_usage_stats s ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
ORDER BY s.user_seeks + s.user_scans + s.user_lookups DESC;
```

---

## References

### Microsoft Documentation

1. **[Azure SQL Database Documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/)**
   - Official Azure SQL documentation
   - Covers all Azure SQL features and best practices

2. **[T-SQL Reference](https://learn.microsoft.com/en-us/sql/t-sql/language-reference)**
   - Complete T-SQL language reference
   - Syntax and examples for all statements

3. **[SQL Server Best Practices](https://learn.microsoft.com/en-us/sql/relational-databases/performance/performance-best-practices)**
   - Performance tuning guidance
   - Index and query optimization

4. **[Azure SQL Security Best Practices](https://learn.microsoft.com/en-us/azure/azure-sql/database/security-best-practice)**
   - Security configuration guidance
   - Authentication and authorization patterns

### Style and Naming Guides

5. **[SQL Style Guide](https://www.sqlstyle.guide/)** by Simon Holywell
   - Widely adopted SQL formatting conventions
   - Comprehensive naming guidelines

6. **[Kickstarter SQL Style Guide](https://gist.github.com/fredbenenson/7bb92718e19138c20591)**
   - Practical, opinionated style guide
   - Used by many organizations

### Performance and Optimization

7. **[Use the Database Engine Tuning Advisor](https://learn.microsoft.com/en-us/sql/relational-databases/performance/database-engine-tuning-advisor)**
   - Automated index and tuning recommendations
   - Workload analysis

8. **[Query Store](https://learn.microsoft.com/en-us/sql/relational-databases/performance/monitoring-performance-by-using-the-query-store)**
   - Performance monitoring and troubleshooting
   - Query plan analysis

9. **[Brent Ozar's SQL Server Training](https://www.brentozar.com/)**
   - Free training videos and resources
   - Performance tuning expertise

### Database Design

10. **[Database Normalization](https://learn.microsoft.com/en-us/office/troubleshoot/access/database-normalization-description)**
    - Normalization principles (1NF through 5NF)
    - When to denormalize

11. **[Entity Framework Core - Modeling](https://learn.microsoft.com/en-us/ef/core/modeling/)**
    - If using EF Core with SQL Server
    - Code-first database design patterns

### Tools

12. **[Azure Data Studio](https://learn.microsoft.com/en-us/azure-data-studio/)**
    - Cross-platform SQL tool
    - Notebooks, extensions, source control integration

13. **[SQL Server Management Studio (SSMS)](https://learn.microsoft.com/en-us/sql/ssms/download-sql-server-management-studio-ssms)**
    - Full-featured SQL Server management
    - Query execution plans, profiling

14. **[DbUp](https://dbup.readthedocs.io/)** / **[Flyway](https://flywaydb.org/)** / **[Liquibase](https://www.liquibase.org/)**
    - Database migration tools
    - Version control for database schemas

---

*Last updated: January 2026*

*This document is part of the project-templates repository.*
