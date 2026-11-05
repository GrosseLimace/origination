import type { TDiscRatedPass, TDiscRatedWindow } from './tdisc.model';

/**
 * Fields under planting intentions, and the sustainability programs recorded on them.
 *
 * A ProducerField is durable: one of the producer's CTRM split IDs plus its location, set up once and
 * offered again in later years. A FieldSeason is that field's share of one planting intention (one crop row): just its acres. Crop,
 * year, type and trade unit come from the intention row, so they are never entered twice, and the
 * intention's Acres stays the total the dashboard counts.
 *
 * Program data never lives on the season. Each program a field takes part in (45Z first, others
 * later) is a FieldProgramRecord holding that program's own data, so adding a program needs no change
 * to fields or seasons. A field is in a program simply by having a record for it.
 */

/**
 * One row of CTRM's Customer Splits Inquiry: a "combined customer" (split) ID under a producer's primary
 * ID. Producers use split IDs for fields, and tickets are delivered under them.
 */
export interface CtrmSplit {
  /** e.g. "TATOB43". */
  splitId: string;
  /** The producer's primary CTRM ID, e.g. "TATOBIN". */
  primaryCustomerId: string;
  /** CTRM's combined customer name, e.g. "T-A TOBIN - JARBOE WEST". */
  name: string;
  /** The name without the producer prefix, e.g. "JARBOE WEST". */
  fieldName: string;
  /** 0–100, e.g. 66.667. */
  splitPercent: number;
  /** yyyy-mm-dd. */
  effectiveDate: string;
  expired: boolean;
  /** A bin-site split collects grain from several fields, so it isn't a field itself. */
  kind: 'Field' | 'Bin';
}

/** A producer's field: one CTRM split, plus the location 45Z needs. Keyed by the split ID. */
export interface ProducerField {
  /** The split ID. */
  fieldKey: string;
  splitId: string;
  customerId: number;
  /** e.g. "JARBOE WEST": from CTRM (read-only here), or typed by hand for a Manual split. */
  name: string;
  splitPercent: number;
  /** yyyy-mm-dd, or "" when unknown. */
  effectiveDate: string;
  state: string;
  county: string;
  /**
   * SPLITS-GRAPHQL: "Manual" while originators type split IDs by hand (go-live, before CTRM's splits query is
   * ready; name and share stay editable), "Ctrm" once they come from CTRM. Absent reads as Manual.
   */
  splitSource?: 'Manual' | 'Ctrm';
}

/** One field's share of one planting intention (crop row). */
export interface FieldSeason {
  id: string;
  fieldKey: string;
  plantingIntentionId: number;
  /** Copied from the intention when the field is added, for history and copy-forward. */
  year: number;
  cropLabel: string;
  acres: number | null;
}

/** A program's headline number for one field, e.g. 45Z's CI in g CO₂e/bu. */
export interface ProgramScore {
  value: number;
  /** Full unit for the record, e.g. "g CO₂e/bu". */
  unit: string;
  /** Short unit for chips, e.g. "g/bu". */
  unitShort: string;
}

/**
 * Draft: inputs still missing. Ready: scored. Locked: confirmed after harvest, with the CI frozen for the
 * audit trail (`frozen`) and the confirmed CI kept as the official result (`official`).
 */
export type ProgramRecordStatus = 'Draft' | 'Ready' | 'Locked';

/** What a program record looked like when it was locked: the audit copy of inputs and outputs. */
export interface FrozenProgramResult {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  /** The headline result, for programs that score a field (45Z: CI). */
  score?: ProgramScore;
  calculatorVersion: string;
  /** Always an estimate: the planning calculation, never the program's official result. */
  basis: 'Estimate';
  lockedBy: string;
  lockedAt: string;
}

export type OfficialResultStatus = 'NotStarted' | 'InProgress' | 'Documented';

/** How an official result's status reads on screen. */
export const OFFICIAL_STATUS_TEXT: Record<OfficialResultStatus, string> = {
  NotStarted: 'not confirmed',
  InProgress: 'in progress',
  Documented: 'confirmed',
};

/**
 * A field's official result for a program (45Z: the CI of record), kept apart from the planning estimate.
 * For 45Z it is the confirmed CI: written only when the originator confirms the field after harvest, having
 * gone over its inputs and CTRM tickets with the producer (the server rescores with the actual yield and keeps
 * the tickets and their bushels). The estimate is never copied into it automatically. It changes only by
 * unlocking the record (see FieldProgramRecord.reopened).
 */
export interface OfficialResult {
  status: OfficialResultStatus;
  score?: ProgramScore;
  /** e.g. a USDA version or a verified pathway. */
  method?: string;
  /** Who confirmed it: their UPN (the audit identifier). */
  documentedBy?: string;
  /** Their display name, for documents such as the Mass Balance Ledger. Absent on older records. */
  documentedByName?: string;
  documentedAt?: string;
  /** 45Z confirmed CI: the actual yield it was rescored with (bu/ac). */
  actualYield?: number;
  /** 45Z confirmed CI: net bushels of the confirmed tickets. */
  bushels?: number;
  /** 45Z confirmed CI: the CTRM tickets reviewed with the producer, listed in the Biofuel Feedstock Report. */
  tickets?: FieldTicket[];
  /**
   * 45Z confirmed CI: the T-DISC check, for no till or reduced till (null otherwise), rated on the server from the
   * field's passes. Tillage as USDA FD-CIC labels; version is the T-DISC release; windows and passes are the worksheet.
   */
  tDisc?: {
    rating: number; designation: string; estimatedTillage: string; confirmedTillage: string;
    version?: string; windows?: TDiscRatedWindow[]; passes?: TDiscRatedPass[];
  } | null;
  /** 45Z confirmed CI: the producer's recordkeeping requirements were reviewed with them. */
  recordkeepingAcknowledged?: boolean;
  /** 45Z confirmed CI: the Doc Store id of this confirmation's Biofuel Feedstock Report; absent until it's saved. */
  reportDocumentId?: string;
}

/** What a 45Z document in Doc Store is. Only the two upload types can be uploaded; the report is saved by confirming. */
export type FieldPlanDocumentType = 'FeedstockReport' | 'ProducerAttestation' | 'Other';
export type FieldPlanUploadType = Exclude<FieldPlanDocumentType, 'FeedstockReport'>;

/** One of a producer's 45Z documents in Doc Store (api/field-plan/customer/{id}/documents). */
export interface FieldPlanDocument {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  /** The originator's display name. */
  uploadedBy?: string | null;
  documentType: FieldPlanDocumentType;
  cropYear?: number | null;
  /** The field, for a Biofuel Feedstock Report. */
  splitId?: string | null;
  commodity?: string | null;
  fieldProgramRecordId?: number | null;
}

/** One delivery (a CTRM ticket's detail row for the field's split), as reviewed, confirmed and exported. */
export interface FieldTicket {
  ticketKey: string;
  ticketNumber: string;
  /** The party the row is for: the producer or a partner on the split. A ticket has a row per party. */
  customerCode?: string | null;
  /** yyyy-mm-dd. */
  blDate: string | null;
  location: string | null;
  productCode: string | null;
  contractNumber: string | null;
  /**
   * How the ticket was matched to the crop year: the applied contract's year, or its BL date in the window.
   * 'other' is outside the crop year (offered to add); once confirmed, an added one is 'added'.
   */
  cropYearMatch: 'contract' | 'window' | 'other' | 'added';
  /** Why an 'other' ticket is outside the crop year, e.g. "On a 2025 contract". */
  note?: string | null;
  /** The crop year whose confirmed CI already counts this ticket; it can't be counted twice. */
  confirmedFor?: number | null;
  /** The split's net bushels; null when CTRM's pounds or the conversion are missing. */
  netBushels: number | null;
  settled: boolean;
  settledDate: string | null;
  status: string | null;
}

/** A field's CTRM tickets for its crop and crop year (GET api/field-plan/records/{id}/tickets). */
export interface FieldTickets {
  splitId: string;
  cropYear: number;
  cropGroup: string | null;
  /** yyyy-mm-dd: the BL-date window for tickets not on a contract with a crop year. */
  windowFrom: string;
  windowTo: string;
  tickets: FieldTicket[];
  /** The split's other tickets for the crop, outside the crop year; counted only when the originator adds one. */
  others?: FieldTicket[];
}

/** One sustainability program on one field season. `data` is the program's own shape. */
export interface FieldProgramRecord<TData = unknown> {
  id: string;
  seasonId: string;
  programKey: string;
  data: TData;
  status: ProgramRecordStatus;
  /** Set when the data was prefilled from the field's previous season. */
  copiedFromYear?: number;
  /** Set when the data was copied from another field this year (its name then), kept for the audit trail. */
  copiedFromField?: string;
  frozen?: FrozenProgramResult;
  /** The official, documented result, once there is one; see OfficialResult. Absent means not started. */
  official?: OfficialResult;
  /** Each unlock (or replacement by a confirmed CI): the reason, when, the locked estimate and any confirmed CI it held. */
  reopened?: { reason: string; at: string; frozen: FrozenProgramResult; official?: OfficialResult }[];
}
