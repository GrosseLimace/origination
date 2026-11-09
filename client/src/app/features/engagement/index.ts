// Public API of the Engagement module: the only file another module may import from it. eslint.config.js enforces that,
// and which modules may import it at all.
export type { RecapGroup, RecapGroupSaveRequest } from './models/recap-group.model';
