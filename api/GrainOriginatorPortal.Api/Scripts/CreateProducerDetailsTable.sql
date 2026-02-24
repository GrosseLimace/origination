-- Create ProducerDetails table in Origination database
-- Stores user-entered producer/customer details not sourced from ODS

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProducerDetails' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.ProducerDetails (
        Id              BIGINT IDENTITY(1,1) NOT NULL,
        CustomerId      BIGINT NOT NULL,
        CustomerName    NVARCHAR(255) NOT NULL,
        BinCapacity     DECIMAL(18,2) NULL,
        PrimaryContact  NVARCHAR(255) NULL,
        Commodities     NVARCHAR(1000) NULL,
        CreatedBy       NVARCHAR(255) NOT NULL,
        CreatedOn       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        ModifiedBy      NVARCHAR(255) NULL,
        ModifiedOn      DATETIME2 NULL,

        CONSTRAINT PK_ProducerDetails PRIMARY KEY (Id)
    );

    CREATE UNIQUE INDEX IX_ProducerDetails_CustomerId ON dbo.ProducerDetails (CustomerId);

    PRINT 'Created dbo.ProducerDetails table';
END
ELSE
BEGIN
    PRINT 'dbo.ProducerDetails table already exists';
END
