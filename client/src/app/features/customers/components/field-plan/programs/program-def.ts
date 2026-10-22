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
  /** The live score, or null while inputs are missing. */
  preview(data: TData, season: FieldSeason, field: ProducerField): ProgramScore | null;

  /** Numbers only known at the end of the season, asked for when finalizing (45Z: actual yield). */
  finalizeInputs: { key: keyof TData & string; label: string }[];
  /** What still stands between the record and Final. */
  finalizeMissing(data: TData, season: FieldSeason): string[];
  /** The audit copy of inputs and outputs stored at finalize. */
  freeze(data: TData, season: FieldSeason, field: ProducerField): Omit<FrozenProgramResult, 'finalizedBy' | 'finalizedAt'>;
  /** The confirmation shown when finalizing. */
  finalizeStatement(season: FieldSeason): string;

  /** A one-line roll-up for a crop row, or null to show none. */
  rowSummary?(items: { season: FieldSeason; record: FieldProgramRecord<TData> }[], intention: { id: number; acres: number }): string | null;

  /** The program's input form. Rendered with NgComponentOutlet; writes through ProgramRecordMockService. */
  intake: Type<ProgramIntake>;

  enrollment: {
    /** Enrollment IDs read `${idPrefix}-${year}-000001`. */
    idPrefix: string;
    /** What the producer confirms when attesting; keys are stored with the answers. */
    statements: { key: string; label: string; short: string }[];
    /** Shown once an enrollment is attested, e.g. what downstream records carry the ID. */
    attestedNote: string;
  };
}

/** The inputs every program's intake component takes. */
export interface ProgramIntake {
  record: InputSignal<FieldProgramRecord>;
  season: InputSignal<FieldSeason>;
  field: InputSignal<ProducerField>;
  disabled: InputSignal<boolean>;
}
