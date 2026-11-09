import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/angular';
import { HELP_ANCHOR_TIPS, HelpSpotlightComponent } from './help-spotlight.component';
import { HelpPanelService } from '@core/help/help-panel.service';
import { provideTestEnvironment } from '@testing/test-providers';

interface Rect { left: number; top: number; width: number; height: number; }

function domRect({ left, top, width, height }: Rect): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

/** happy-dom has no layout, so each test says where its elements are. */
function placeAt(element: HTMLElement, rect: Rect): void {
  element.getBoundingClientRect = () => domRect(rect);
}

const added: HTMLElement[] = [];

/** A control carrying data-help-anchor, laid out at `rect`. */
function addAnchor(anchor: string, rect: Rect): HTMLElement & { scrollIntoView: ReturnType<typeof vi.fn> } {
  const element = document.createElement('div');
  element.setAttribute('data-help-anchor', anchor);
  placeAt(element, rect);
  element.scrollIntoView = vi.fn();
  document.body.appendChild(element);
  added.push(element);
  return element as HTMLElement & { scrollIntoView: ReturnType<typeof vi.fn> };
}

const windowSize = {
  innerWidth: Object.getOwnPropertyDescriptor(window, 'innerWidth'),
  innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight')
};

function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

async function renderSpotlight() {
  const result = await render(HelpSpotlightComponent, { providers: provideTestEnvironment() });
  const panel = result.fixture.debugElement.injector.get(HelpPanelService);

  /** Starts a spotlight and lets the component react. */
  function show(anchor: string): void {
    panel.showOnScreen(anchor);
    result.fixture.detectChanges();
  }

  /** The outline drawn around the control (the element just before the tooltip). */
  function outline(): HTMLElement {
    return screen.getByRole('dialog').previousElementSibling as HTMLElement;
  }

  return { ...result, panel, show, outline };
}

describe('HelpSpotlightComponent', () => {
  beforeEach(() => setWindowSize(1280, 800));

  afterEach(() => {
    vi.useRealTimers();
    added.splice(0).forEach(e => e.remove());
    for (const [key, descriptor] of Object.entries(windowSize)) {
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else delete (window as unknown as Record<string, unknown>)[key];
    }
  });

  it('outlines the control just outside its edges, scrolls it into view, and puts its tip below it', async () => {
    const element = addAnchor('producer-search', { left: 100, top: 200, width: 80, height: 30 });
    const { show, outline } = await renderSpotlight();

    show('producer-search');

    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    // 6px of padding on every side.
    expect(outline().style.left).toBe('94px');
    expect(outline().style.top).toBe('194px');
    expect(outline().style.width).toBe('92px');
    expect(outline().style.height).toBe('42px');
    const tip = screen.getByRole('dialog');
    // Lined up with the outline's left edge, 12px under its bottom edge.
    expect(tip.style.left).toBe('94px');
    expect(tip.style.top).toBe('248px');
    expect(tip.textContent).toContain(HELP_ANCHOR_TIPS['producer-search']);
  });

  it('keeps the tip on screen: above the control when there is no room below, and inside the window edges', async () => {
    const low = addAnchor('producer-search', { left: 1200, top: 700, width: 60, height: 30 });
    const { show, fixture } = await renderSpotlight();

    show('producer-search');

    let tip = screen.getByRole('dialog');
    // Outline top 694; the tip's 152px allowance goes above it.
    expect(tip.style.top).toBe('542px');
    // Outline left 1194 would push the 300px tip off the right edge: held 12px in from it.
    expect(tip.style.left).toBe(`${1280 - 300 - 12}px`);

    placeAt(low, { left: 0, top: 0, width: 60, height: 30 });
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();

    tip = screen.getByRole('dialog');
    // Outline at -6,-6: held 12px in from the left, and the tip goes below as there's room.
    expect(tip.style.left).toBe('12px');
    expect(tip.style.top).toBe('48px');
  });

  it('skips copies of the control that are hidden, and measures a component host by its children', async () => {
    addAnchor('trade-unit-selector', { left: 0, top: 0, width: 0, height: 0 });
    const host = addAnchor('trade-unit-selector', { left: 0, top: 0, width: 0, height: 0 });
    for (const rect of [{ left: 300, top: 50, width: 100, height: 20 }, { left: 320, top: 80, width: 200, height: 40 }]) {
      const child = document.createElement('div');
      placeAt(child, rect);
      host.appendChild(child);
    }
    const { show, outline } = await renderSpotlight();

    show('trade-unit-selector');

    expect(host.scrollIntoView).toHaveBeenCalled();
    // The union of the children (300,50 → 520,120), padded by 6px.
    expect(outline().style.left).toBe('294px');
    expect(outline().style.top).toBe('44px');
    expect(outline().style.width).toBe('232px');
    expect(outline().style.height).toBe('82px');
  });

  it('waits for a control that appears once its screen has loaded', async () => {
    const { show, fixture, panel } = await renderSpotlight();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });

    show('producer-search');
    expect(screen.queryByRole('dialog')).toBeNull();

    vi.advanceTimersByTime(1000);
    addAnchor('producer-search', { left: 40, top: 60, width: 200, height: 30 });
    vi.advanceTimersByTime(100);
    fixture.detectChanges();

    expect(screen.getByRole('dialog').textContent).toContain(HELP_ANCHOR_TIPS['producer-search']);
    expect(panel.spotlight()).toBe('producer-search');
  });

  it('gives up after four seconds and goes back to the panel when the control never appears', async () => {
    const { show, fixture, panel } = await renderSpotlight();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });

    show('trade-unit-selector');
    vi.advanceTimersByTime(3900);
    expect(panel.spotlight()).toBe('trade-unit-selector');

    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    expect(panel.spotlight()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to Help' })).toBeNull();
  });

  it('follows the control when the page scrolls', async () => {
    const element = addAnchor('bid-sheet-add', { left: 100, top: 400, width: 80, height: 30 });
    const { show, fixture, outline } = await renderSpotlight();
    show('bid-sheet-add');

    placeAt(element, { left: 100, top: 250, width: 80, height: 30 });
    // Scrolling inside any container, not just the window.
    element.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();

    expect(outline().style.top).toBe('244px');
  });

  it('ends the spotlight from Got it or the Back to Help tab', async () => {
    addAnchor('producer-search', { left: 100, top: 200, width: 80, height: 30 });
    const { show, fixture, panel } = await renderSpotlight();

    show('producer-search');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fixture.detectChanges();

    expect(panel.spotlight()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    show('producer-search');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Help' }));
    fixture.detectChanges();

    expect(panel.spotlight()).toBeNull();
  });

  it('stops watching the window and looking for the control when it is destroyed', async () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { show, fixture, panel } = await renderSpotlight();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    show('trade-unit-selector');

    fixture.destroy();
    vi.advanceTimersByTime(5000);

    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    // The search was cancelled, so it never timed out and ended the spotlight itself.
    expect(panel.spotlight()).toBe('trade-unit-selector');
    removeListener.mockRestore();
  });
});
