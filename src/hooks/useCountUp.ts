// §18.8 — count-up animation for live numeric stat values.
// Returns an animated display value that smoothly interpolates toward `target`.
// When the value changes, the number counts up/down over `duration` ms.
import { useEffect, useRef, useState } from "react";

export function useCountUp(
  target: number,
  opts?: { duration?: number; decimals?: number },
): number {
  const { duration = 600, decimals = 0 } = opts ?? {};
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  const raf = useRef<number>(0);
  const start = useRef(0);

  useEffect(() => {
    const from = prev.current;
    const to = target;
    if (from === to) return;
    prev.current = to;

    cancelAnimationFrame(raf.current);
    start.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * ease;
      setDisplay(parseFloat(current.toFixed(decimals)));
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration, decimals]);

  return display;
}
