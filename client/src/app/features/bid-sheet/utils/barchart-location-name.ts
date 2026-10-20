import { BarchartCatalogLocation } from '@models';

/** Letters and digits only, upper-cased — so "Salina, KS", "SALINA KS" and "salinaks" all match. */
function nameKey(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The part that distinguishes one of a company's locations from another — or empty when the vendor's
 * site name is just the town again and would only repeat the subtitle line beneath it.
 *
 * Measured on the live catalog (2026-08-19, 3,446 listings): 1,775 set the site name to the city and
 * another 304 set it to the city plus the state ("Salina, KS", "FARNSWORTH TX") — 60% of the catalog
 * between them, and that share has held steady as the catalog grew. Comparison is on letters and
 * digits only, so all those spellings collapse the same way.
 */
export function barchartSiteLabel(location: BarchartCatalogLocation): string {
  const site = location.locationName?.trim() ?? '';
  if (!site) return '';

  const key = nameKey(site);
  const city = nameKey(location.city);
  if (city && (key === city || key === city + nameKey(location.state))) return '';

  return site;
}

/**
 * Headline for a listing: the company, then which of its sites — "Farmers Cooperative Dorchester -
 * Beattie". Omits the site qualifier when it would just repeat the city, since that already shows on
 * the subtitle line beneath it.
 *
 * Company leads deliberately. The vendor's site name alone is a poor label: half of them are just the
 * town, which is ambiguous on a bid sheet, and some name a different company than the one publishing
 * the bid (a CHS listing whose site name is "GPC Muscatine") — leading with that would misattribute
 * the price at a glance.
 */
export function barchartDisplayName(location: BarchartCatalogLocation): string {
  const company = location.elevator?.trim();
  const site = barchartSiteLabel(location);
  if (company && site) return `${company} - ${site}`;
  return company || site || `BarChart ${location.locationKey}`;
}

/**
 * The name a listing is saved to the bid sheet under. Shared by the BarChart picker's bulk add and a
 * click-to-add off the map's catalog layer, so a location gets the same name whichever path added it.
 *
 * Unlike barchartDisplayName, this ALWAYS carries a site or town when one exists, even if it repeats
 * the city -- a saved bid sheet row has no second line to disambiguate on, and a company with several
 * town-named sites would otherwise want the same row name for all of them.
 */
export function barchartSaveName(location: BarchartCatalogLocation): string {
  const company = location.elevator?.trim();
  const site = barchartSiteLabel(location) || location.city?.trim() || '';
  if (company && site) return `${company} - ${site}`;
  return company || site || `BarChart ${location.locationKey}`;
}

/**
 * Whether a catalog listing is one of ours.
 *
 * A name match on the publishing company, which is all the vendor feed gives us -- there is no
 * ownership flag on a BarChart listing. Deliberately checks `elevator` (the publisher) and not
 * `locationName`, because a site name is sometimes another company's name entirely.
 *
 * Shared rather than duplicated: the picker uses it to set isScoularFacility when adding, and the map
 * uses it to colour candidate pins green. Two copies of a rule this loose would drift, and then a pin
 * would disagree with the row that added it.
 */
export function isScoularListing(location: BarchartCatalogLocation): boolean {
  return (location.elevator ?? '').toLowerCase().includes('scoular');
}
