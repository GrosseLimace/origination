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
 * to fields or seasons. Producer-level sign-off is a ProgramEnrollment per program per year.
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
  /** From CTRM, e.g. "JARBOE WEST"; read-only here. */
  name: string;
  splitPercent: number;
  /** yyyy-mm-dd. */
  effectiveDate: string;
  state: string;
  county: string;
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
 * Draft: inputs still missing. Ready: scored. Locked: the harvest estimate frozen for the audit trail
 * (harvest complete). Every status is a planning estimate; an official result is `official`, apart.
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
  NotStarted: 'not started',
  InProgress: 'in progress',
  Documented: 'documented',
};

/**
 * A field's official, documented result for a program (45Z: the CI of record), kept apart from the
 * planning estimate. PLACEHOLDER: what an official result requires (more inputs, evidence, a verifier,
 * sign-off, a method) is still being gathered, so nothing writes this yet. The planning estimate must
 * never be copied into it automatically.
 */
export interface OfficialResult {
  status: OfficialResultStatus;
  score?: ProgramScore;
  /** e.g. a USDA version or a verified pathway. */
  method?: string;
  requirements?: { key: string; label: string; met: boolean }[];
  evidence?: { kind: string; reference: string; addedBy: string; addedAt: string }[];
  documentedBy?: string;
  documentedAt?: string;
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
  /** Each time a locked record was reopened for correction, with the reason given. */
  reopened?: { reason: string; at: string; frozen: FrozenProgramResult }[];
}

/** Open: ID issued, producer hasn't signed. Attested: producer signed. Withdrawn: ID retired. */
export type EnrollmentStatus = 'Open' | 'Attested' | 'Withdrawn';

/** The producer's signed statement for one program year. Confirmations are keyed by the program's statements. */
export interface ProgramAttestation {
  signerName: string;
  /** yyyy-mm-dd. */
  signedOn: string;
  method: 'eSign' | 'Paper';
  documentRef: string;
  confirmations: Record<string, boolean>;
}

/** A program record as its enrollment lists it. */
export interface EnrollableRecord {
  recordId: string;
  seasonId: string;
  fieldKey: string;
  fieldName: string;
  splitId: string;
  /** The field's enrollment ID in the program for the year, derived from split ID + crop year. */
  enrollmentId: string;
  cropLabel: string;
  year: number;
  acres: number | null;
  status: ProgramRecordStatus;
  score?: ProgramScore;
  /** Why there is no score yet when the inputs are in, e.g. "calculating…" (see the program's previewNote). */
  scoreNote?: string;
  /** The field's production (45Z: acres × actual yield, in bushels). */
  production?: number | null;
}

/**
 * One producer's enrollment in one program for one year: what harvest complete, attestation and
 * withdrawal apply to. Created when the producer's first field enters the program, before harvest; every
 * record the producer has in the program that year belongs to it. It has no ID of its own: each field in
 * it has one, derived from its split ID and the crop year (enrollmentIdFor), which is what downstream
 * records (45Z: delivery lots in the CI ledger) point back to and what a ticket resolves to.
 */
export interface ProgramEnrollment {
  key: string;
  programKey: string;
  customerId: number;
  year: number;
  status: EnrollmentStatus;
  attestation: ProgramAttestation;
  attestedBy?: string;
  attestedAt?: string;
  /** The producer's records as they stood when attested (projected scores before harvest). */
  snapshot?: EnrollableRecord[];
  /** Set when harvest is marked complete for the enrollment: every complete field is locked. */
  harvestCompleteAt?: string;
  withdrawnReason?: string;
}
