import { FdCicData, Tillage } from '../../../../models/carbon-intensity.model';

/**
 * The documents a 45Z producer keeps for a field, in plain words, by what the field's inputs claim: each line
 * names a document and what it must show. Shown on the review's recordkeeping step and in the Biofuel Feedstock
 * Report. From 7 CFR Part 2100: 2100.030(d) (keep 5 years), 2100.031(b)-(d) (sales, expected yield, actual
 * yield at standard moisture), 2100.051(c) (tillage), 2100.052(b) (cover crop), 2100.061 and 2100.063 (nutrients,
 * inhibitor, manure), and 2100.031(e)(4)(vi) (no-till 4 of 5 years). Practice rules (what may or may not be
 * done in the field) are not repeated here. The business owns this wording: edit it here.
 */
export interface RecordkeepingGroup {
  key: 'always' | 'inhibitor' | 'manure' | 'coverCrop' | 'tillage' | 'noTill';
  title: string;
  items: string[];
}

export const KEEP_YEARS = 5;

/** What counts as a record (2100.051(c), .052(b), .063). */
export const RECORD_FORMS =
  'Records can be paper or digital: receipts, invoices, seed tags, farm software or equipment data, dated photos, or USDA program records.';

/** Standard moisture the actual yield is adjusted to (2100.020(a)(4)). */
const STANDARD_MOISTURE = 'corn 15.5%, soybeans 13%, sorghum 14%, spring canola 8.5%';

/** The groups that apply to these inputs, in order. Tillage is the one the CI is confirmed at. */
export function recordkeepingFor(data: Pick<FdCicData, 'niFraction' | 'manure' | 'coverCrop'>, tillage: Tillage): RecordkeepingGroup[] {
  const groups: RecordkeepingGroup[] = [{
    key: 'always',
    title: 'Every field',
    items: [
      'Field map or location, with its acres',
      'Planting date',
      'Nutrient plan, written before any fertilizer or manure went on: yield goal and planned N, P and K (lb/ac), counting every source (fertilizer, manure, legumes, residue, irrigation water)',
      'What the nutrient plan is based on: a soil test from the last 2 years (results, lab, test method and date), or a signed statement from an ag expert who isn\'t related to the farm (Extension, a university, or FCIC-approved)',
      'Every fertilizer application: date, method, where on the field, and lb/ac of N, P and K',
      'Fertilizer receipts showing the product, how much, and its nutrient content',
      'Expected yield proof: the crop insurance policy showing the approved yield, or a printout of the RMA transitional yield or FSA ARC-County benchmark yield used',
      `Total bushels harvested from this field, adjusted to standard moisture (${STANDARD_MOISTURE})`,
      'Every sale of this crop: amount, moisture, buyer, date, and the CI for reduced-CI sales (settlement sheets or scale tickets)',
    ],
  }];
  if (data.niFraction > 0) {
    groups.push({
      key: 'inhibitor', title: 'Nitrification inhibitor',
      items: ['Receipts showing the inhibitor product and the amount applied (an AAPFCO-defined product your state accepts)'],
    });
  }
  if (data.manure.length > 0) {
    groups.push({
      key: 'manure', title: 'Manure',
      items: [
        'A manure test for each type of manure, sampled this crop year, showing N, P and K',
        'For each test: sample date, where the sample was taken, and the animal it came from',
        'Every manure application: date, method, where on the field, and amount',
        'Bought or traded manure: receipts showing date, amount, type, and where it came from',
        'Manure from your own livestock: head count or flock size for the year (livestock insurance, inventory, sales or permit records)',
      ],
    });
  }
  if (data.coverCrop !== 'None') {
    groups.push({
      key: 'coverCrop', title: 'Cover crop',
      items: [
        'Seed receipts or seed tags showing enough seed for the acres seeded',
        'Seeding date, method and rate',
        'Total cover crop acres across the whole operation',
        'A dated photo showing the cover crop came up',
        'Termination date and method',
        'Bushels harvested from this field from the crop before the cover crop',
        'With a legume in the mix: a nutrient plan showing the N the cover crop supplies and the cut in planned N',
        ...(data.coverCrop === 'CoverCropGrazed' ? ['Dated, geotagged photos of the cover crop being grazed'] : []),
      ],
    });
  }
  if (tillage === 'NoTill' || tillage === 'ReducedTill') {
    groups.push({
      key: 'tillage', title: tillage === 'NoTill' ? 'No till' : 'Reduced till',
      items: [
        'A log of every pass from last harvest through this one, including planting, spraying, fertilizing and harvest',
        'For each pass: date, equipment used, type of operation, depth and width of soil disturbance, and average speed',
        'The USDA T-DISC worksheet (it\'s on the Biofuel Feedstock Report)',
      ],
    });
  }
  if (tillage === 'NoTill') {
    groups.push({ key: 'noTill', title: 'Staying no-till', items: ['Keep this field no-till at least 4 of every 5 years'] });
  }
  return groups;
}
