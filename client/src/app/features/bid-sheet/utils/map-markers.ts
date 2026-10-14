/**
 * Bid sheet map markers.
 *
 * Pure builders for the HTML and sizing of the map's Leaflet `divIcon`s — the bid pills, name
 * labels, dots, the expanded hover/panel pin and the add-location pin — plus the colour rules that
 * pick each pin's fill. The page owns Leaflet (it is lazy-loaded) and wraps these options in
 * `L.divIcon(...)`; nothing here touches Leaflet or the DOM.
 *
 * Security: these strings become innerHTML. Every DATA value (location name, bid text) goes through
 * `esc` before it is interpolated; everything else is a constant colour or a computed number.
 */

/** The options the page hands to `L.divIcon` — assignable to Leaflet's `DivIconOptions`. */
export interface MarkerIconOptions {
  className: string;
  html: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
}

export interface PinColors {
  bg: string;
  border: string;
}

/**
 * Scoular facilities read as GREEN in both map modes — the expression just changes with what the
 * fill is already being used for:
 *
 *   no reference set  → green FILL (replaces the gray "no status" fill)
 *   reference set     → status FILL kept (blue/red/yellow), green RING added
 *
 * Splitting it this way is what lets our facilities stand out regionally without ever destroying
 * the bid comparison the map exists for. Keyed on the reference alone — selecting a crop is not a
 * comparison, and gating on crop is what once made the ring appear with no reference chosen.
 */
export const SCOULAR_BG = '#00875F';
export const SCOULAR_BORDER = '#006B4C';
/** Ring green is the brighter brand green, not the darker SCOULAR_BG used for fills. The fill has
 *  white text on it so it needs the accessible darker shade; the ring carries no text, and the
 *  brighter green is far easier to pick out against a red or blue pill. */
export const SCOULAR_RING = '#00A36F';

/** Pin colours per bid status (vs the session reference). */
export const STATUS_COLORS: Record<string, PinColors> = {
  reference: { bg: '#2563eb', border: '#1d4ed8' },
  beating:   { bg: '#dc2626', border: '#991b1b' },
  matching:  { bg: '#eab308', border: '#a16207' },
  none:      { bg: '#6b7280', border: '#4b5563' }
};

/** Default fill of a dot / name label that has no status and is not ours. */
export const PIN_GREY: PinColors = { bg: '#9ca3af', border: '#6b7280' };
/** Default fill of the expanded (panel-open) pin. */
export const EXPANDED_PIN_GREY: PinColors = { bg: '#6b7280', border: '#4b5563' };

export function esc(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** Green "ours" ring as a box-shadow prefix, for use when the fill is carrying bid status.
 *  Sits flush against the pin border (no white gap) and 4px thick, so it reads as a green band
 *  around the pin rather than a hairline. box-shadow (not border/outline) so it takes no layout
 *  space and Leaflet's icon anchors stay correct. */
export function scoularRing(isScoular: boolean): string {
  return isScoular ? `0 0 0 4px ${SCOULAR_RING},` : '';
}

/** Same ring as a complete `box-shadow:` declaration, for elements that carry no shadow of their
 *  own — appending to `box-shadow:none` would be invalid CSS and silently drop the ring. */
export function scoularRingCss(isScoular: boolean): string {
  return isScoular ? `box-shadow:0 0 0 4px ${SCOULAR_RING};` : '';
}

// ── Fill rules ──────────────────────────────────────────────────────────────────────────────────

/**
 * Fill for a dot, a name label or the expanded pin, in priority order: the reference is blue; while
 * a comparison runs (`compareStatus` not null) the pin takes its bid's status colour; otherwise a
 * Scoular facility is green and anything else falls back to `fallback`.
 */
export function pinFill(isRef: boolean, compareStatus: string | null, isScoular: boolean, fallback: PinColors = PIN_GREY): PinColors {
  if (isRef) return { bg: STATUS_COLORS['reference'].bg, border: STATUS_COLORS['reference'].border };
  if (compareStatus !== null) {
    const c = STATUS_COLORS[compareStatus] ?? STATUS_COLORS['none'];
    return { bg: c.bg, border: c.border };
  }
  if (isScoular) return { bg: SCOULAR_BG, border: SCOULAR_BORDER };
  return { bg: fallback.bg, border: fallback.border };
}

/**
 * Fill for one line of a bid pill. The reference is blue. No reference means there is no comparison
 * to colour by, so ours are simply green rather than a gray "no status" pill wearing a ring.
 */
export function bidPillFill(isNameRef: boolean, status: string, isScoular: boolean, comparingToRef: boolean): PinColors {
  if (isNameRef) return { bg: STATUS_COLORS['reference'].bg, border: STATUS_COLORS['reference'].border };
  if (!comparingToRef && isScoular) return { bg: SCOULAR_BG, border: SCOULAR_BORDER };
  const c = STATUS_COLORS[status] ?? STATUS_COLORS['none'];
  return { bg: c.bg, border: c.border };
}

// ── Icons ───────────────────────────────────────────────────────────────────────────────────────

/** Small coloured dot used below the bid-pin zoom threshold. */
export function dotIcon(color: string, border: string, ring: boolean): MarkerIconOptions {
  return {
    className: 'custom-marker',
    html: `<div style="width:14px;height:14px;background:${color};border:2px solid ${border};border-radius:50%;box-shadow:${scoularRing(ring)}0 1px 3px rgba(0,0,0,0.3);cursor:pointer;"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7]
  };
}

export interface BidPillItem {
  label: string;
  bg: string;
  border: string;
  isScoular: boolean;
}

/** Stacked bid pills for every location at one coordinate, with a pointer in the first pill's colour. */
export function bidPillsIcon(bidItems: BidPillItem[], comparingToRef: boolean): MarkerIconOptions {
  const linesHtml = bidItems.map(({ label, bg, border, isScoular }) => {
    const isGrey = bg === '#d1d5db';
    const pillBg = isGrey ? '#6b7280' : bg;
    const pillBorder = isGrey ? '#4b5563' : border;
    return `<div style="background:${pillBg};border:2px solid ${pillBorder};border-radius:6px;padding:5px 6px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:${scoularRing(comparingToRef && isScoular)}0 2px 4px rgba(0,0,0,0.3);line-height:1.2;cursor:pointer;">${esc(label)}</div>`;
  }).join('');
  const maxWidth = Math.max(58, ...bidItems.map(({ label }) => label.length * 7 + 16));
  const height = bidItems.length * 28 + 16;
  const primaryBg = bidItems[0].bg;
  return {
    className: 'custom-marker',
    html: `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
              ${linesHtml}
              <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${primaryBg};margin:-1px auto 0;"></div>
            </div>`,
    iconSize: [maxWidth, height],
    iconAnchor: [maxWidth / 2, height]
  };
}

/** Name-label pin for every location at one coordinate (see `stackedLabelHtml`). */
export function nameLabelIcon(names: string[], bg: string, border: string, statusDriven: boolean, scoularNames: ReadonlySet<string>): MarkerIconOptions {
  const maxWidth = Math.max(80, ...names.map(n => n.length * 6 + 20));
  return {
    className: 'custom-marker',
    html: stackedLabelHtml(names, bg, border, statusDriven, scoularNames),
    iconSize: [maxWidth, names.length * 26 + 8],
    iconAnchor: [maxWidth / 2, names.length * 26 + 8]
  };
}

export function stackedLabelHtml(names: string[], bg: string, border: string, statusDriven: boolean, scoularNames: ReadonlySet<string>): string {
  const isGrey = bg === '#d1d5db' || bg === '#9ca3af';
  const textColor = '#fff';
  const labelBg = isGrey ? '#6b7280' : bg;
  const labelBorder = isGrey ? '#4b5563' : border;
  const maxWidth = Math.min(150, Math.max(85, ...names.map(n => n.length * 7 + 22)));
  // Both cues are per NAME, not per pin: a stacked label can hold several locations at one
  // coordinate and only some may be ours. Painting the whole stack from one flag would mark a
  // competitor as ours just for sharing a coordinate with a Scoular elevator.
  //   no reference → green FILL on our lines only
  //   reference set → status fill kept, green RING on our lines only (a green ring on a green
  //                   fill would be invisible, which is why these are exclusive)
  const linesHtml = names.map(n => {
    const mine = scoularNames.has(n);
    const lineBg = !statusDriven && mine ? SCOULAR_BG : labelBg;
    const lineBorder = !statusDriven && mine ? SCOULAR_BORDER : labelBorder;
    return `<div style="background:${lineBg};border:2px solid ${lineBorder};border-radius:5px;padding:4px 8px;font-size:11px;font-weight:700;color:${textColor};white-space:nowrap;line-height:1.2;overflow:hidden;text-overflow:ellipsis;max-width:${maxWidth}px;${scoularRingCss(statusDriven && mine)}">${esc(n)}</div>`;
  }).join('');
  return `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;">
      ${linesHtml}
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${labelBorder};margin:-1px auto 0;"></div>
    </div>`;
}

/** Expanded icon showing location name + bid value (hover state, and the panel-open pin). */
export function hoverIcon(name: string, bid: string, bg: string, border: string, scoularNames: ReadonlySet<string>): MarkerIconOptions {
  const nameHtml = `<div style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.2;">${esc(name)}</div>`;
  const bidLabel = bid || '--';
  const subHtml = bid
    ? `<div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.85);white-space:nowrap;line-height:1.2;margin-top:2px;">${esc(bidLabel)}</div>`
    : '';
  const textLen = Math.max(name.length, bidLabel.length + 3);
  const w = Math.max(100, textLen * 7 + 24);
  const h = bid ? 50 : 36;
  return {
    className: 'custom-marker',
    html: `<div style="position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;">
        <div style="background:${bg};border:2px solid ${border};border-radius:8px;padding:5px 9px;box-shadow:${scoularRing(scoularNames.has(name) && bg !== SCOULAR_BG)}0 3px 10px rgba(0,0,0,0.3);cursor:pointer;">${nameHtml}${subHtml}</div>
        <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${bg};margin:-1px auto 0;"></div>
      </div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h]
  };
}

/** The red "+" pin dropped where the user clicks in add-location mode. */
export function addLocationPinIcon(): MarkerIconOptions {
  return {
    className: 'custom-marker',
    html: `<div style="width:28px;height:28px;background:#EF4623;border:3px solid #DF3410;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  };
}
