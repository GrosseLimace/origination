import { Routes } from '@angular/router';
import { CwsWorkspaceComponent, cwsRoutes, provideCwsWorkspace } from '@cws/workspace';

import { environment } from '../../../environments/environment';
import { CWS_SAMPLE_DATA_PROVIDERS, CWS_SPIKE_CONFIG } from './cws-spike.providers';

// Providers live on this route, not at root, so CWS gets its own HttpClient, sign-in and state
// and ours stay untouched. The /cws prefix must stay static: CWS reads it once.
export const CWS_SPIKE_ROUTES: Routes = [
  {
    path: '',
    component: CwsWorkspaceComponent,
    providers: [
      provideCwsWorkspace(CWS_SPIKE_CONFIG),
      ...(environment.cws.sampleData ? CWS_SAMPLE_DATA_PROVIDERS : []),
    ],
    children: cwsRoutes(),
  },
];
