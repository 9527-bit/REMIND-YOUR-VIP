import { useCallback, useRef } from "react";

/**
 * High-performance cursor spotlight hook.
 * Directly mutates CSS variables on the DOM node to eliminate React re-renders.
 */
export function useCardSpotlight() {
  const cardRef = useRef<HTMLElement>(null);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty("--mouse-x", `${x}px`);
    card.style.setProperty("--mouse-y", `${y}px`);
  }, []);

  const onMouseEnter = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--spotlight-opacity", "1");
    card.style.setProperty("--brand-glow-opacity", "0.14");
  }, []);

  const onMouseLeave = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--spotlight-opacity", "0");
    card.style.setProperty("--brand-glow-opacity", "0.04");
  }, []);

  return { cardRef, onMouseMove, onMouseEnter, onMouseLeave };
}
