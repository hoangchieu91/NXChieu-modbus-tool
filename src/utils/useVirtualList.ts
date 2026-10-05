import { useEffect, useState } from 'react';

/**
 * Windowed rendering for long fixed-height lists (analyzer frame tables hold up to 2000 rows
 * and refresh every ~800 ms). Only the rows in view plus `overscan` rows on each side are
 * rendered; the spacer keeps the scrollbar exact.
 *
 * Usage: put `ref` on the scrolling element, render a spacer of `totalHeight` containing the
 * `visible` rows translated by `offsetTop`. Every row must be exactly `rowHeight` px tall.
 */
export function useVirtualList<T>(items: T[], rowHeight: number, overscan = 8) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });

  useEffect(() => {
    if (!element) return;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [element]);

  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - overscan);
  const end = Math.min(items.length, start + Math.ceil(viewport.height / rowHeight) + overscan * 2);
  return {
    ref: setElement,
    visible: items.slice(start, end),
    offsetTop: start * rowHeight,
    totalHeight: items.length * rowHeight,
  };
}
