import { Injectable, InjectionToken, inject } from '@angular/core';
import { SustainabilityProgramDef } from './program-def';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { createFdCicProgram } from './fd-cic/fd-cic.program';

/**
 * The sustainability programs a field can take part in: 45Z, the only approved program. Adding a program is
 * one entry here (plus its definition and intake component, and its rules in the API's FieldPlanPrograms);
 * tests provide their own list to prove the host code is generic.
 * A program that scores on the API (45Z) is built here with its service.
 */
export const SUSTAINABILITY_PROGRAMS = new InjectionToken<SustainabilityProgramDef[]>('SUSTAINABILITY_PROGRAMS', {
  providedIn: 'root',
  factory: () => [createFdCicProgram(inject(FdCicApiService))],
});

@Injectable({ providedIn: 'root' })
export class ProgramRegistry {
  readonly all = inject(SUSTAINABILITY_PROGRAMS);

  get(key: string): SustainabilityProgramDef | undefined {
    return this.all.find(p => p.key === key);
  }

  /** Programs that apply to a crop row. */
  eligible(cropLabel: string): SustainabilityProgramDef[] {
    return this.all.filter(p => p.appliesTo(cropLabel));
  }
}
