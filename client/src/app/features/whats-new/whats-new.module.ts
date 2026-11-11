import { ModuleManifest } from '@core/modules/module-manifest';

export const whatsNewModule: ModuleManifest = {
  id: 'whats-new',
  spaOnly: true,
  // Release notes, open to everyone. The notes file itself is the switch: a deploy that adds no entry announces
  // nothing, and the page says nothing has been published yet. The header's own What's New item links here.
  routes: [
    { path: 'whats-new', requires: [], loadComponent: () => import('./pages/whats-new/whats-new.component').then(m => m.WhatsNewComponent) },
  ],
};
