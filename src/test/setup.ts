import { afterEach } from "vitest";
import { FakeResizeObserver } from "@/test/resize-observer";

// Only DOM-based tests (`@vitest-environment jsdom`) need the browser shims below.
if (typeof window !== "undefined") {
  // Leaflet picks SVG vs. canvas at import time; jsdom has neither, so claim SVG.
  const svg = SVGElement.prototype as unknown as { createSVGRect?: () => unknown };
  svg.createSVGRect ??= () => ({});

  // jsdom has no layout. Give every element a size so Leaflet can compute bounds.
  for (const [prop, value] of [["clientWidth", 800], ["clientHeight", 600]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }

  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  await import("@testing-library/jest-dom/vitest");

  afterEach(async () => {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
    FakeResizeObserver.instances.clear();
  });
}
