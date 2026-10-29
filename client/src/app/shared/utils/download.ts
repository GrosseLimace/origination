/** Hands a file to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a tick, not immediately: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
