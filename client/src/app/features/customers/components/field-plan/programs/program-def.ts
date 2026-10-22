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
  /** What carries over from the field's previous season in this program, or null for nothing. */
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
   * What the field should have delivered on the enrollment's tickets (45Z: acres × actual yield, in
   * bushels), or null while unknown. The enrollment totals it and checks it against the tickets.
   * Leave it out for a program that doesn't reconcile against deliveries.
   */
  production?(data: TData, season: FieldSeason): number | null;
  /** What still stands between the record and Final when the enrollment's harvest is marked complete. */
  finalizeMissing(data: TData, season: FieldSeason, field: ProducerField): string[];
  /** The audit copy of inputs and outputs stored at finalize. */
  freeze(data: TData, season: FieldSeason, field: ProducerField): Omit<FrozenProgramResult, 'finalizedBy' | 'finalizedAt'>;

  /**
   * A one-line roll-up for a crop row, or null to show none: the main figure (45Z: "CI 2,629 g/bu")
   * and, optionally, its change against the program's baseline, which is shown green when better.
   */
  rowSummary?(items: { season: FieldSeason; record: FieldProgramRecord<TData>; field: ProducerField }[], intention: { id: number; acres: number }): RowSummary | null;
  /**
   * The short text on the field's program chip when the program has no score to show, e.g.
   * GrainCraft's variety. Programs with a score (45Z) leave it out and the chip shows the score.
   */
  chipText?(data: TData): string | null;

  /** The program's input form. Rendered with NgComponentOutlet; writes through ProgramRecordMockService. */
  intake: Type<ProgramIntake>;

  /**
   * Producer-level enrollment, for programs that have one (45Z): an ID per producer per year, issued
   * once a field in the program has its FSA numbers, plus the producer's signed attestation. A
   * program without it records field data only.
   */
  enrollment?: {
    /** Enrollment IDs read `${idPrefix}-${year}-000001`. */
    idPrefix: string;
    /** What the producer confirms when attesting; keys are stored with the answers. */
    statements: { key: string; label: string; short: string }[];
    /** Shown once an enrollment is attested, e.g. what downstream records carry the ID. */
    attestedNote: string;
  };
}

/** A crop row's roll-up for one program. */
export interface RowSummary {
  text: string;
  /** e.g. "▼59% vs national"; `better` colours it green (amber when worse). */
  change?: { text: string; better: boolean };
}

/** The inputs every program's intake component takes. */
export interface ProgramIntake {
  record: InputSignal<FieldProgramRecord>;
  season: InputSignal<FieldSeason>;
  field: InputSignal<ProducerField>;
  disabled: InputSignal<boolean>;
}
