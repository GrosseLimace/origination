-- Add Filters column to SavedLists for persisting structured refinement filters as JSON
ALTER TABLE dbo.SavedLists
ADD Filters NVARCHAR(MAX) NULL;
