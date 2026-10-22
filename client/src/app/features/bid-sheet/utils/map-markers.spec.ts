import { describe, expect, it } from 'vitest';
import {
  addLocationPinIcon,
  bidPillFill,
  bidPillsIcon,
  dotIcon,
  esc,
  EXPANDED_PIN_GREY,
  hoverIcon,
  nameLabelIcon,
  PIN_GREY,
  pinFill,
  SCOULAR_BG,
  SCOULAR_BORDER,
  SCOULAR_RING,
  scoularRing,
  scoularRingCss,
  stackedLabelHtml,
  STATUS_COLORS,
} from './map-markers';

const HOSTILE = `O'Neil <img src=x onerror=alert(1)> & "Co"`;
const HOSTILE_ESCAPED = 'O&#039;Neil &lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;';
const none = new Set<string>();

describe('esc', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(esc(HOSTILE)).toBe(HOSTILE_ESCAPED);
  });

  it('returns an empty string for empty input', () => {
    expect(esc('')).toBe('');
  });
});

describe('Scoular ring', () => {
  it('is a box-shadow prefix only for our facilities', () => {
    expect(scoularRing(true)).toBe(`0 0 0 4px ${SCOULAR_RING},`);
    expect(scoularRing(false)).toBe('');
  });

  it('has a complete declaration form for elements without a shadow of their own', () => {
    expect(scoularRingCss(true)).toBe(`box-shadow:0 0 0 4px ${SCOULAR_RING};`);
    expect(scoularRingCss(false)).toBe('');
  });
});

describe('pinFill', () => {
  it('the reference is blue regardless of anything else', () => {
    expect(pinFill(true, 'beating', true)).toEqual(STATUS_COLORS['reference']);
  });

  it('a running comparison colours by status, even for our facilities', () => {
    expect(pinFill(false, 'beating', true)).toEqual(STATUS_COLORS['beating']);
    expect(pinFill(false, 'matching', false)).toEqual(STATUS_COLORS['matching']);
    expect(pinFill(false, 'none', false)).toEqual(STATUS_COLORS['none']);
  });

  it('without a comparison ours are green and the rest fall back to grey', () => {
    expect(pinFill(false, null, true)).toEqual({ bg: SCOULAR_BG, border: SCOULAR_BORDER });
    expect(pinFill(false, null, false)).toEqual(PIN_GREY);
    expect(pinFill(false, null, false, EXPANDED_PIN_GREY)).toEqual({ bg: '#6b7280', border: '#4b5563' });
  });
});

describe('bidPillFill', () => {
  it('reference first, then green for ours only when no reference is set, else status', () => {
    expect(bidPillFill(true, 'reference', true, false)).toEqual(STATUS_COLORS['reference']);
    expect(bidPillFill(false, 'beating', true, false)).toEqual({ bg: SCOULAR_BG, border: SCOULAR_BORDER });
    expect(bidPillFill(false, 'beating', true, true)).toEqual(STATUS_COLORS['beating']);
    expect(bidPillFill(false, 'none', false, false)).toEqual(STATUS_COLORS['none']);
  });
});

describe('dotIcon', () => {
  it('is a 14px circle centred on the point, ringed only on request', () => {
    expect(dotIcon('#9ca3af', '#6b7280', false)).toEqual({
      className: 'custom-marker',
      html: '<div style="width:14px;height:14px;background:#9ca3af;border:2px solid #6b7280;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    expect(dotIcon(SCOULAR_BG, SCOULAR_BORDER, true).html).toContain(`box-shadow:0 0 0 4px ${SCOULAR_RING},0 1px 3px`);
  });
});

describe('bidPillsIcon', () => {
  const item = (label: string, bg = '#dc2626', border = '#991b1b', isScoular = false) => ({ label, bg, border, isScoular });

  it('stacks one escaped pill per location and anchors at the bottom centre', () => {
    const icon = bidPillsIcon([item('4.10'), item(HOSTILE)], false);
    expect(icon.html).toContain('>4.10</div>');
    expect(icon.html).toContain(`>${HOSTILE_ESCAPED}</div>`);
    expect(icon.html).not.toContain('<img');
    const width = HOSTILE.length * 7 + 16;
    expect(icon.iconSize).toEqual([width, 2 * 28 + 16]);
    expect(icon.iconAnchor).toEqual([width / 2, 2 * 28 + 16]);
  });

  it('is at least 58px wide and points in the first pill\'s colour', () => {
    const icon = bidPillsIcon([item('1', '#2563eb', '#1d4ed8'), item('2')], false);
    expect(icon.iconSize[0]).toBe(58);
    expect(icon.html).toContain('border-top:8px solid #2563eb');
  });

  it('maps the light grey to the darker pill grey and rings ours only while comparing', () => {
    expect(bidPillsIcon([item('1', '#d1d5db', '#000')], false).html).toContain('background:#6b7280;border:2px solid #4b5563');
    expect(bidPillsIcon([item('1', '#dc2626', '#991b1b', true)], true).html).toContain(`box-shadow:0 0 0 4px ${SCOULAR_RING},0 2px 4px`);
    expect(bidPillsIcon([item('1', '#dc2626', '#991b1b', true)], false).html).toContain('box-shadow:0 2px 4px');
  });
});

describe('name labels', () => {
  const ours = new Set(['Scoular Plant']);

  it('fills our lines green when there is no reference, without a ring', () => {
    const html = stackedLabelHtml(['Rival Coop', 'Scoular Plant'], PIN_GREY.bg, PIN_GREY.border, false, ours);
    expect(html).toContain('background:#6b7280;border:2px solid #4b5563;border-radius:5px'); // grey → label grey
    expect(html).toContain(`background:${SCOULAR_BG};border:2px solid ${SCOULAR_BORDER};border-radius:5px`);
    expect(html).not.toContain(SCOULAR_RING);
  });

  it('keeps the status fill and rings only our lines once a reference is set', () => {
    const html = stackedLabelHtml(['Rival Coop', 'Scoular Plant'], '#dc2626', '#991b1b', true, ours);
    expect(html.match(/background:#dc2626/g)).toHaveLength(2);
    expect(html.match(new RegExp(SCOULAR_RING, 'g'))).toHaveLength(1);
  });

  it('escapes every name and clamps the label width to 85..150px', () => {
    expect(stackedLabelHtml([HOSTILE], '#2563eb', '#1d4ed8', false, none)).toContain(`>${HOSTILE_ESCAPED}</div>`);
    expect(stackedLabelHtml(['A'], '#2563eb', '#1d4ed8', false, none)).toContain('max-width:85px');
    expect(stackedLabelHtml(['A'.repeat(40)], '#2563eb', '#1d4ed8', false, none)).toContain('max-width:150px');
  });

  it('nameLabelIcon sizes the icon by the longest name and the number of lines', () => {
    const icon = nameLabelIcon(['Alpha Coop', 'Bravo Grain Elevator Co'], '#2563eb', '#1d4ed8', false, none);
    const width = 'Bravo Grain Elevator Co'.length * 6 + 20;
    expect(icon.iconSize).toEqual([width, 2 * 26 + 8]);
    expect(icon.iconAnchor).toEqual([width / 2, 2 * 26 + 8]);
    expect(nameLabelIcon(['A'], '#2563eb', '#1d4ed8', false, none).iconSize).toEqual([80, 34]);
  });
});

describe('hoverIcon', () => {
  it('shows the escaped name and bid, taller when there is a bid', () => {
    const icon = hoverIcon(HOSTILE, '4.10<b>', '#2563eb', '#1d4ed8', none);
    expect(icon.html).toContain(`>${HOSTILE_ESCAPED}</div>`);
    expect(icon.html).toContain('>4.10&lt;b&gt;</div>');
    expect(icon.iconSize).toEqual([HOSTILE.length * 7 + 24, 50]);
    expect(hoverIcon('Alpha', '', '#2563eb', '#1d4ed8', none).iconSize).toEqual([100, 36]);
  });

  it('rings our facility unless it is already filled green', () => {
    const ours = new Set(['Scoular Plant']);
    expect(hoverIcon('Scoular Plant', '4.10', '#dc2626', '#991b1b', ours).html).toContain(`0 0 0 4px ${SCOULAR_RING},`);
    expect(hoverIcon('Scoular Plant', '4.10', SCOULAR_BG, SCOULAR_BORDER, ours).html).not.toContain(SCOULAR_RING);
    expect(hoverIcon('Rival', '4.10', '#dc2626', '#991b1b', ours).html).not.toContain(SCOULAR_RING);
  });
});

describe('addLocationPinIcon', () => {
  it('is a 28px red pin centred on the click, fresh on every call', () => {
    const a = addLocationPinIcon();
    expect(a.iconSize).toEqual([28, 28]);
    expect(a.iconAnchor).toEqual([14, 14]);
    expect(a.html).toContain('background:#EF4623');
    expect(addLocationPinIcon()).not.toBe(a);
  });
});
