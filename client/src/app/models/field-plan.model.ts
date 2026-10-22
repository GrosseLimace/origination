/**
 * Fields under planting intentions, and the sustainability programs recorded on them.
 *
 * A ProducerField is durable: a name and a location, entered once and offered again in later years.
 * A FieldSeason is that field's share of one planting intention (one crop row): just its acres. Crop,
 * year, type and trade unit come from the intention row, so they are never entered twice, and the
 * intention's Acres stays the total the dashboard counts.
 *
 * Program data never lives on the season. Each program a field takes part in (45Z first, others
 * later) is a FieldProgramRecord holding that program's own data, so adding a program needs no change
 * to fields or seasons. Producer-level sign-off is a ProgramEnrollment per program per year.
 */

/** A producer's field: a name, its FSA farm/tract/field numbers, and the location 45Z needs. */
export interface ProducerField {
  fieldKey: string;
  customerId: number;
  /** As the producer knows it, e.g. "Penka #1 irrigated". */
  name: string;
  fsaFarmNo: string;
  fsaTractNo: string;
  fsaFieldNo: string;
  state: string;
  county: string;
}

/**
 * A scale ticket assigned to a program enrollment. The ticket carries the enrollment ID, not a
 * field: bushels are checked against the enrollment's fields as a whole. PROTOTYPE: simulated until
 * the CTRM ticket feed is wired.
 */
export interface EnrollmentTicket {
  ticketNo: string;
  /** yyyy-mm-dd. */
  date: string;
  netBushels: number;
  /** As assigned on the ticket. */
  enrollmentId: string;
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
  /** Fractional change against the program's baseline (45Z: national average), when it has one. */
  vsBaseline?: number;
}

/** Draft: inputs still missing. Ready: scored, can be finalized. Final: frozen and locked. */
export type ProgramRecordStatus = 'Draft' | 'Ready' | 'Final';

/** What a program record looked like when it was finalized: the audit copy of inputs and outputs. */
export interface FrozenProgramResult {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  score: ProgramScore;
  calculatorVersion: string;
  finalizedBy: string;
  finalizedAt: string;
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
  frozen?: FrozenProgramResult;
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
  /** "farm/tract/field", or empty when the FSA numbers aren't all filled in. */
  fsa: string;
  cropLabel: string;
  year: number;
  acres: number | null;
  status: ProgramRecordStatus;
  score?: ProgramScore;
  /** What the field should have delivered (45Z: acres × actual yield, in bushels), for the ticket check. */
  production?: number | null;
}

/**
 * One producer's enrollment in one program for one year: the ID that incoming tickets are assigned,
 * and that downstream records (45Z: delivery lots in the CI ledger) point back to. Issued when the
 * producer's first field enters the program, before harvest; never reused, even after a withdrawal.
 * Every record the producer has in the program that year belongs to it.
 */
export interface ProgramEnrollment {
  key: string;
  programKey: string;
  enrollmentId: string;
  customerId: number;
  year: number;
  status: EnrollmentStatus;
  attestation: ProgramAttestation;
  attestedBy?: string;
  attestedAt?: string;
  /** The producer's records as they stood when attested (projected scores before harvest). */
  snapshot?: EnrollableRecord[];
  /** Set when harvest is marked complete for the enrollment: every complete field is finalized. */
  harvestCompleteAt?: string;
  withdrawnReason?: string;
}
