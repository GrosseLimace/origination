using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Data only (user 2026-10-09): the producer-level Bin Capacity input is going away and every Grain
    /// on Farm row now belongs to a bin site, so nothing producers already entered is cleared:
    ///   • a producer with BinCapacity &gt; 0, or with grain-on-farm rows not tied to a site, gets ONE new
    ///     bin site named "Bin 1" — "Bin N+1" if they already have N sites (Dev only; QA/PROD had no
    ///     sites before this release) — with Capacity = their BinCapacity (NULL when they had none),
    ///     sorted after any existing sites, no coordinates;
    ///   • every grain row of theirs not tied to a site is tied to that new site. The new site holds no
    ///     grain yet, so UQ_ProducerGrainOnFarm_Customer_Site_Commodity cannot collide.
    /// Runs before 20261009201700_DropProducerDetailsBinCapacity in the same deploy, which removes the
    /// column it reads. Set-based and one statement batch; a producer with nothing to move is untouched.
    /// Down is a no-op: the created sites are ordinary sites by then and may have been edited.
    /// </summary>
    public partial class MoveBinCapacityAndGrainOntoBinSites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DECLARE @need TABLE (CustomerId bigint PRIMARY KEY, Capacity decimal(18,2) NULL, ExistingSites int NOT NULL, SiteKey uniqueidentifier NOT NULL);

INSERT INTO @need (CustomerId, Capacity, ExistingSites, SiteKey)
SELECT n.CustomerId,
       (SELECT d.BinCapacity FROM dbo.ProducerDetails d WHERE d.CustomerId = n.CustomerId AND d.BinCapacity > 0),
       (SELECT COUNT(*) FROM dbo.ProducerBinSite b WHERE b.CustomerId = n.CustomerId),
       NEWID()
FROM (SELECT CustomerId FROM dbo.ProducerDetails WHERE BinCapacity > 0
      UNION
      SELECT CustomerId FROM dbo.ProducerGrainOnFarm WHERE BinSiteId IS NULL) AS n;

INSERT INTO dbo.ProducerBinSite (CustomerId, SiteKey, Name, Latitude, Longitude, Capacity, SortOrder)
SELECT CustomerId, SiteKey, CONCAT(N'Bin ', ExistingSites + 1), NULL, NULL, Capacity, ExistingSites
FROM @need;

UPDATE g
SET g.BinSiteId = b.Id
FROM dbo.ProducerGrainOnFarm AS g
JOIN @need AS n ON n.CustomerId = g.CustomerId
JOIN dbo.ProducerBinSite AS b ON b.SiteKey = n.SiteKey
WHERE g.BinSiteId IS NULL;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Intentionally empty: see the summary.
        }
    }
}
