-- Create SavedLists table for query-based saved customer lists
-- Run this on the ORIGINATION database
CREATE TABLE dbo.SavedLists (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    Name      NVARCHAR(100) NOT NULL,
    Query     NVARCHAR(500) NOT NULL,
    CreatedBy NVARCHAR(255) NOT NULL DEFAULT 'System',
    CreatedOn DATETIME NOT NULL DEFAULT GETUTCDATE(),
    IsActive  BIT NOT NULL DEFAULT 1
);
