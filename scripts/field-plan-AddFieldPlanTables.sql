BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE TABLE [dbo].[ProducerField] (
        [Id] int NOT NULL IDENTITY,
        [CustomerId] bigint NOT NULL,
        [SplitId] nvarchar(20) NOT NULL,
        [Name] nvarchar(255) NOT NULL,
        [SplitPercent] decimal(7,3) NOT NULL,
        [EffectiveDate] date NULL,
        [State] nvarchar(2) NULL,
        [County] nvarchar(100) NULL,
        [CreatedAt] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy] nvarchar(255) NOT NULL,
        [ModifiedAt] datetime2 NULL,
        [ModifiedBy] nvarchar(255) NULL,
        CONSTRAINT [PK_ProducerField] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ProducerField_Customer_CustomerId] FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customer] ([CustomerId])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE TABLE [dbo].[ProgramEnrollment] (
        [Id] int NOT NULL IDENTITY,
        [EnrollmentKey] uniqueidentifier NOT NULL DEFAULT (NEWID()),
        [CustomerId] bigint NOT NULL,
        [ProgramKey] nvarchar(30) NOT NULL,
        [CropYear] int NOT NULL,
        [Status] nvarchar(10) NOT NULL,
        [Attestation] nvarchar(max) NOT NULL,
        [AttestedBy] nvarchar(255) NULL,
        [AttestedAt] datetime2 NULL,
        [Snapshot] nvarchar(max) NULL,
        [HarvestCompleteAt] datetime2 NULL,
        [WithdrawnReason] nvarchar(500) NULL,
        [CreatedAt] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy] nvarchar(255) NOT NULL,
        [ModifiedAt] datetime2 NULL,
        [ModifiedBy] nvarchar(255) NULL,
        CONSTRAINT [PK_ProgramEnrollment] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ProgramEnrollment_Customer_CustomerId] FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customer] ([CustomerId])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE TABLE [dbo].[ProducerFieldSeason] (
        [Id] int NOT NULL IDENTITY,
        [ProducerFieldId] int NOT NULL,
        [PlantingIntentionId] int NOT NULL,
        [CropYear] int NOT NULL,
        [CropLabel] nvarchar(100) NOT NULL,
        [Acres] decimal(10,2) NULL,
        [CreatedAt] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy] nvarchar(255) NOT NULL,
        [ModifiedAt] datetime2 NULL,
        [ModifiedBy] nvarchar(255) NULL,
        [IsDeleted] bit NOT NULL DEFAULT CAST(0 AS bit),
        [DeletedAt] datetime2 NULL,
        [DeletedBy] nvarchar(255) NULL,
        CONSTRAINT [PK_ProducerFieldSeason] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ProducerFieldSeason_ProducerField_ProducerFieldId] FOREIGN KEY ([ProducerFieldId]) REFERENCES [dbo].[ProducerField] ([Id]),
        CONSTRAINT [FK_ProducerFieldSeason_ProducerPlantingIntentions_PlantingIntentionId] FOREIGN KEY ([PlantingIntentionId]) REFERENCES [dbo].[ProducerPlantingIntentions] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE TABLE [dbo].[FieldProgramRecord] (
        [Id] int NOT NULL IDENTITY,
        [ProducerFieldSeasonId] int NOT NULL,
        [ProgramKey] nvarchar(30) NOT NULL,
        [Status] nvarchar(10) NOT NULL,
        [Data] nvarchar(max) NOT NULL,
        [CopiedFromYear] int NULL,
        [CopiedFromField] nvarchar(255) NULL,
        [Frozen] nvarchar(max) NULL,
        [LockedBy] nvarchar(255) NULL,
        [LockedAt] datetime2 NULL,
        [Reopened] nvarchar(max) NULL,
        [Official] nvarchar(max) NULL,
        [CreatedAt] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
        [CreatedBy] nvarchar(255) NOT NULL,
        [ModifiedAt] datetime2 NULL,
        [ModifiedBy] nvarchar(255) NULL,
        [IsDeleted] bit NOT NULL DEFAULT CAST(0 AS bit),
        [DeletedAt] datetime2 NULL,
        [DeletedBy] nvarchar(255) NULL,
        CONSTRAINT [PK_FieldProgramRecord] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_FieldProgramRecord_ProducerFieldSeason_ProducerFieldSeasonId] FOREIGN KEY ([ProducerFieldSeasonId]) REFERENCES [dbo].[ProducerFieldSeason] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UQ_FieldProgramRecord_Season_Program] ON [dbo].[FieldProgramRecord] ([ProducerFieldSeasonId], [ProgramKey]) WHERE [IsDeleted] = 0');
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE INDEX [IX_ProducerField_CustomerId] ON [dbo].[ProducerField] ([CustomerId]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE UNIQUE INDEX [UQ_ProducerField_SplitId] ON [dbo].[ProducerField] ([SplitId]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE INDEX [IX_ProducerFieldSeason_PlantingIntentionId] ON [dbo].[ProducerFieldSeason] ([PlantingIntentionId]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE INDEX [IX_ProducerFieldSeason_ProducerFieldId] ON [dbo].[ProducerFieldSeason] ([ProducerFieldId]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE INDEX [IX_ProgramEnrollment_Program_Year] ON [dbo].[ProgramEnrollment] ([ProgramKey], [CropYear], [Status]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    CREATE UNIQUE INDEX [UQ_ProgramEnrollment_EnrollmentKey] ON [dbo].[ProgramEnrollment] ([EnrollmentKey]);
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UQ_ProgramEnrollment_Live] ON [dbo].[ProgramEnrollment] ([CustomerId], [ProgramKey], [CropYear]) WHERE [Status] IN (''Open'', ''Attested'')');
END;

IF NOT EXISTS (
    SELECT * FROM [dbo].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261027115725_AddFieldPlanTables'
)
BEGIN
    INSERT INTO [dbo].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261027115725_AddFieldPlanTables', N'10.0.3');
END;

COMMIT;
GO

