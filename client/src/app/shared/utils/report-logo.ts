const SCOULAR_LOGO = 'assets/images/scoular-logo-dark.webp';

/**
 * Loads the app's Scoular logo (same-origin webp) as a PNG data URL for jsPDF, which doesn't reliably embed
 * webp. Same-origin → canvas isn't tainted → toDataURL works. Null on failure (callers fall back to text).
 */
export function loadReportLogo(): Promise<{ dataUrl: string; ratio: number } | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), ratio: img.naturalWidth / img.naturalHeight });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = SCOULAR_LOGO;
  });
}
