import { Routes } from '@angular/router';
import { CwsWorkspaceComponent, cwsRoutes, provideCwsWorkspace } from '@cws/workspace';

import { CWS_SPIKE_CONFIG, CWS_SPIKE_OVERRIDES } from './cws-spike.providers';

// Providers live on this route, not at root, so CWS gets its own HttpClient, sign-in and state
// and ours stay untouched. The /cws prefix must stay static: CWS reads it once.
export const CWS_SPIKE_ROUTES: Routes = [
  {
    path: '',
    component: CwsWorkspaceComponent,
    providers: [provideCwsWorkspace(CWS_SPIKE_CONFIG), ...CWS_SPIKE_OVERRIDES],
    children: cwsRoutes(),
  },
];
