import { FdCicScore, FdCicScoreRequest, FdCicScoreState } from '@models';
import { FdCicApiService } from '@core/services/fd-cic-api.service';

/**
 * A stand-in for the API calculator in specs: answers at once with a made-up but predictable score
 * (lower for no-till, a cover crop and an inhibitor; higher with more N), so specs can check how the
 * 45Z program uses a score without the USDA arithmetic. The real arithmetic is tested in the API.
 */
export function fakeFdCicApi(mode: 'done' | 'loading' | 'unscorable' = 'done') {
  const requests: { year: number; request: FdCicScoreRequest }[] = [];
  const api = {
    requests,
    score(year: number, request: FdCicScoreRequest): FdCicScoreState {
      requests.push({ year, request });
      if (mode === 'loading') return { status: 'loading' };
      const national = 6000;
      const actual = request.actualYield ?? request.expectedYield;
      const yieldForCi = Math.min(Math.max(actual, 0.8 * request.expectedYield), 1.2 * request.expectedYield);
      const ci = 5000 + request.syntheticN * 5
        - (request.tillage === 'None of the above' ? 0 : 600)
        - (request.coverCrop === 'No cover crop' ? 0 : 400)
        - request.niFraction * 300;
      const score: FdCicScore = {
        version: '1.2', label: 'USDA FD-CIC v1.2', sourceSha256: 'db3e', formulaFingerprint: 'a2cc',
        projected: request.actualYield === null, scorable: mode === 'done',
        unscorableReason: mode === 'unscorable' ? 'USDA FD-CIC v1.2 has no Corn data for Pratt County, KS (MLRA 78).' : null,
        mlra: '78', yieldForCi,
        components: mode === 'done' ? { nFertilizer: 1000, soilCarbon: -500, directN2o: 2000, indirectN2o: 500, onFarmEnergy: 800, otherChemicals: 470, ureaLime: ci - 4270 } : null,
        ci: mode === 'done' ? ci : null, nationalAverage: national,
        changeFraction: mode === 'done' ? (ci - national) / national : null,
        effects: [], unit: 'g CO2e/bu',
      };
      return { status: 'done', score };
    },
  };
  return api as unknown as typeof api & FdCicApiService;
}
