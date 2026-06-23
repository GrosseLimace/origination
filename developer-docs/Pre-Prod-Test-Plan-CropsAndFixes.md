Origination QA Test List – 06/08

1.	Show more columns on Open Contracts (#344)
•	Change: Added a "More columns" toggle to the Open Contracts tab that reveals Remaining Quantity, Total Delivered, and Unsettled Quantity as inline columns, so reps can see fulfillment detail without opening each contract. While expanded the table goes full width and the Notes panel drops below it (no horizontal scrolling). New columns are sortable; missing values show "—".
•	Verify: Open a producer → Contracts tab → click "More columns." The three columns appear, the table widens and Notes drops below, and the values match the figures in a contract's expanded "Fulfillment" detail. Sort by each new column. Click "Fewer columns" and Notes returns to the right side. Existing columns, row expand, and sorting still work.

2.	Bid Sheet Export – distinguish Old Crop / New Crop (#340)
•	Change: The Bid Sheet Print dialog adds a "Show Old Crop / New Crop" option with independent Yearly and Monthly toggles. When on, each column prints two adjacent crop years — the prior year as "Old Crop (YYYY)" and the year you're viewing as "New Crop (YYYY)" — in both the on-screen preview and the printed/PDF output.
•	Verify: Bid Sheet → Edit Bids → Print. Turn on Yearly and/or Monthly; the columns split into Old Crop / New Crop with the correct years side by side. Old Crop values match the prior year's bids (step the grid back a year to confirm); New Crop matches the year you're viewing. Print and confirm the PDF matches the preview. With both toggles off, the printout is unchanged.

3.	Build a List – modify saved list (member) functionality (#341)
•	Change: When managing the members of a saved list, including or excluding a producer no longer clears the search. The results stay open and only the producer you just picked drops off the list, so several related producers can be added/excluded from one search without retyping.
•	Verify: Open a saved list → manage members → search a term that returns several producers. Include one — the search term and remaining results stay, and only that producer leaves the list. Include/exclude more from the same results without retyping. Save and reopen the list; the member changes persist.

4.	Tighten the commodities listed in the dropdown – Planting Intentions (#319)
•	Change: The curated "Planting Intentions" commodity list now drives the crop pickers on Planting Intentions, the producer-details edit dialog, and the Bid Sheet Add-Location search — one clean set instead of the full ~250-code catalog. Existing saved commodities still display by name. The curated set was also reconciled across environments (incl. Non-GMO Soybeans) so each environment shows the same crops.
•	Verify: Producer → Edit → commodity search shows the short curated list (not the full catalog), and a producer that already has a non-curated commodity still shows it. Same curated set appears in Planting Intentions → Add and Bid Sheet → Add Location. Confirm QA matches Dev (Non-GMO Soybeans is present).
