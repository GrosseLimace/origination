-- Migration: Add LinkedProducerIds column to dbo.ProducerDetails
-- Run once against the Origination database.
ALTER TABLE dbo.ProducerDetails
ADD LinkedProducerIds varchar(1000) NULL;
