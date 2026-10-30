import { InputSignal, Type } from '@angular/core';
import { FieldProgramRecord, FieldSeason, FrozenProgramResult, ProducerField, ProgramScore } from '@models';

/**
 * A sustainability program a field can take part in (45Z first, others later). Everything that is
 * specific to one program lives behind this contract, so the field list, field dialog, record store
 * and enrollment card never change when a program is added: write a definition and an intake
 * component, and register the definition in SUSTAINABILITY_PROGRAMS.
 */
export interface SustainabilityProgramDef<TData = any> {
  key: string;
  /** e.g. "45Z clean fuel credit (USDA FD-CIC)". */
  label: string;
  /** For chips and tabs, e.g. "45Z". */
  shortLabel: string;
  description: string;

  /** Whether the program applies to a crop row, e.g. 45Z only scores corn, soybeans, sorghum and canola. */
  appliesTo(cropLabel: string): boolean;
  /** A new record's data, with the program's defaults chosen. */
  blankData(): TData;
  /**
   * What carries over from one record's data to another in this program, or null for nothing: from the
   * field's previous season, and from another field this year ("copy from" / "copy to"). Crop-specific
   * inputs should only carry between the same crop.
   */
  copyForward(prior: TData, priorCropLabel: string, cropLabel: string): Partial<TData> | null;

  /** Inputs still needed before the program can score the field (Draft until empty). */
  missing(data: TData, season: FieldSeason): string[];
  /** The live score, or null while inputs are missing or the score isn't back yet. */
  preview(data: TData, season: FieldSeason, field: ProducerField): ProgramScore | null;
  /**
   * A short word for the field's chip when there is no score but the inputs are in, e.g. 45Z's
   * "calculating…" or "no USDA data". Leave it out for a program that scores locally or not at all.
   */
  previewNote?(data: TData, season: FieldSeason, field: ProducerField): string | null;

  /**
   * The field's production (45Z: acres × actual yield, in bushels), or null while unknown, shown on
   * the enrollment card. Leave it out for a program that doesn't track production.
   */
  production?(data: TData, season: FieldSeason): number | null;
  /** The audit copy of inputs and outputs stored when the record is locked (45Z: on confirming). */
  freeze(data: TData, season: FieldSeason, field: ProducerField): Omit<FrozenProgramResult, 'basis' | 'lockedBy' | 'lockedAt'>;

  /** A one-line roll-up for a crop row, or null to show none (45Z: "CI 2,629 g/bu"). */
  rowSummary?(items: { season: FieldSeason; record: FieldProgramRecord<TData>; field: ProducerField }[], intention: { id: number; acres: number }): RowSummary | null;
  /**
   * Each field's score and bushels, for the enrollment card's "bushels by CI" ladder (one per group, e.g.
   * 45Z's crop). Field level on purpose: opportunities set different CI targets, so a producer is never
   * collapsed into one average. Left out by a program that doesn't score fields.
   */
  fieldResults?(items: { season: FieldSeason; record: FieldProgramRecord<TData>; field: ProducerField }[]): FieldResult[];
  /**
   * The short text on the field's program chip when the program has no score to show, e.g.
   * GrainCraft's variety. Programs with a score (45Z) leave it out and the chip shows the score.
   */
  chipText?(data: TData): string | null;

  /** The program's input form. Rendered with NgComponentOutlet; writes through FieldPlanStore.updateRecord. */
  intake: Type<ProgramIntake>;

  /**
   * The program has an official, documented result apart from its planning estimate (45Z: an official CI).
   * Its requirements are still being defined, so this only names it and says so; each record's
   * `official` holds the result once there is one.
   */
  official?: {
    /** e.g. "45Z CI". */
    resultName: string;
    /** Shown with the estimates, e.g. "Requirements for an official 45Z CI are being defined." */
    requirementsNote: string;
  };

  /**
   * Enrollment, for programs that have one (45Z): each field's ID for the year, derived from its split ID
   * and the crop year, grouped per producer for attestation and withdrawal. A program
   * without it records field data only.
   */
  enrollment?: {
    /** Enrollment IDs read `${idPrefix}-${cropYear}-${splitId}` (provisional; see enrollmentIdFor). */
    idPrefix: string;
    /** What the producer confirms when attesting; keys are stored with the answers. */
    statements: { key: string; label: string; short: string }[];
    /** Shown once an enrollment is attested, e.g. what downstream records carry the ID. */
    attestedNote: string;
  };
}

/**
 * A crop row's roll-up for one program. The raw figure only: no comparison with a baseline (45Z: the
 * national average), which would suggest it decides whether a field qualifies for an opportunity.
 */
export interface RowSummary {
  text: string;
  /** The figure alone for tight spots, e.g. a collapsed enrollment card: "Corn 2,874". Falls back to `text`. */
  short?: string;
}

/** One field's score and bushels in a program (see `fieldResults`). */
export interface FieldResult {
  recordId: string;
  /** Results are only compared within a group (45Z: the FD-CIC crop, since corn and soybeans differ). */
  group: string;
  /** The score, or null while the field has none. */
  value: number | null;
  unitShort: string;
  /** What the field produces: actual once known, otherwise projected; null when it can't be worked out. */
  bushels: number | null;
  projected: boolean;
}

/** The inputs every program's intake component takes. */
export interface ProgramIntake {
  record: InputSignal<FieldProgramRecord>;
  season: InputSignal<FieldSeason>;
  field: InputSignal<ProducerField>;
  disabled: InputSignal<boolean>;
}
