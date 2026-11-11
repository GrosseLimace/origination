// Public API of the Engagement module: the only file another module may import from it. eslint.config.js enforces that,
// and which modules may import it at all.
export type { RecapGroup, RecapGroupSaveRequest } from './models/recap-group.model';
export { RecapGroupsApiService } from './data-access/recap-groups-api.service';

// The notes, the last-contact summary and the user's follow-ups every screen shares, which Lists' prompts and the
// Planting Dashboard read, and the calls the trade units' notes are read with. The customer screen reads the selected
// customer's through SelectedProducerEngagement in core.
export { EngagementStore } from './data-access/engagement.store';
export { EngagementApiService } from './data-access/engagement-api.service';
