using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Infrastructure.Data.Migrations
{
    /*
       Migration:   MoveManualBidsToBasisColumn
       Author:      Origination engineering
       Description: Moves every manually entered bid out of the cash column and into the basis column,
                    because that is what originators have actually been typing there.
       Rollback:    Down() moves them back.
    */

    /// <summary>
    /// Corrects what the Bid column means on manually entered rows.
    ///
    /// Originators have always typed a BASIS into the Bid field -- the values in Dev read "-40Z",
    /// "-105K", "-95X", which is trade notation for forty under December, a hundred and five under May.
    /// No corn bid is negative. The column was simply the only one there, so basis went into it.
    ///
    /// The BarChart feed then arrived and filled the same column with a genuine cash price (4.98) while
    /// putting its basis in BasisBid. So the sheet has been showing "-95X" beside "4.98" in one column
    /// and calling both of them cash, which makes the side-by-side comparison the screen exists for
    /// meaningless, and had the status colouring comparing a basis against a flat price.
    ///
    /// This moves manual values to where they belong and leaves cash empty for users to fill in, now
    /// that the grid can capture both. Scoped to Source = 'Manual': feed rows already have the split
    /// right and must not be touched. Guarded on BasisBid IS NULL so it cannot overwrite a basis that
    /// somehow already exists.
    ///
    /// Measured on Dev before writing: 42 manual rows, none with an existing basis, none with an empty
    /// bid -- so all 42 move cleanly and no data is lost.
    /// </summary>
    public partial class MoveManualBidsToBasisColumn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
UPDATE dbo.BidSheetLocationBids
   SET BasisBid = Bid,
       Bid      = N''
 WHERE Source = N'Manual'
   AND BasisBid IS NULL
   AND NULLIF(LTRIM(RTRIM(Bid)), N'') IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Only reverses rows this migration could have created: a manual row whose cash is empty and
            // whose basis is not. A manual row that has since gained a real cash price is left alone,
            // because moving its basis back would destroy the cash value.
            migrationBuilder.Sql(@"
UPDATE dbo.BidSheetLocationBids
   SET Bid      = BasisBid,
       BasisBid = NULL
 WHERE Source = N'Manual'
   AND NULLIF(LTRIM(RTRIM(Bid)), N'') IS NULL
   AND BasisBid IS NOT NULL;");
        }
    }
}
