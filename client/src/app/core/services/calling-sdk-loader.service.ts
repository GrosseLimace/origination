import { Injectable } from '@angular/core';
import type { CallClient } from '@azure/communication-calling';
import type { AzureCommunicationTokenCredential } from '@azure/communication-common';

/** The two SDK constructors the incoming-call service needs. */
export interface CallingSdk {
  CallClient: typeof CallClient;
  AzureCommunicationTokenCredential: typeof AzureCommunicationTokenCredential;
}

/**
 * Loads the Azure Communication Services calling SDK on demand.
 *
 * The SDK is several megabytes. Importing it dynamically keeps it out of the initial bundle (and
 * its budget) entirely; it is only fetched for a user whose environment actually returned a
 * calling token. Isolated in its own injectable so tests can substitute a fake SDK without
 * touching module resolution.
 */
@Injectable({ providedIn: 'root' })
export class CallingSdkLoader {
  async load(): Promise<CallingSdk> {
    const [calling, common] = await Promise.all([
      import('@azure/communication-calling'),
      import('@azure/communication-common'),
    ]);
    return {
      CallClient: calling.CallClient,
      AzureCommunicationTokenCredential: common.AzureCommunicationTokenCredential,
    };
  }
}
