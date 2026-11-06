/**
 * Failures the user has already been told about, so a screen doesn't toast the same failure again.
 *
 * The 403 interceptor marks each 403 it toasts. A screen's error handler checks `alreadyShown(err)`
 * before showing its own "Failed to …" toast, which stops one failure producing two toasts.
 */
const shown = new WeakSet<object>();

/** Records that the user has been shown this failure. */
export function markShown(error: object): void {
  shown.add(error);
}

/**
 * Whether the user has already been shown this failure. API clients wrap the HTTP response in an
 * `ApiError` (or another `Error`) and keep it as `cause`, so the cause chain is checked too.
 */
export function alreadyShown(error: unknown): boolean {
  let current: unknown = error;
  // Bounded, in case a cause chain ever loops.
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if (shown.has(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
