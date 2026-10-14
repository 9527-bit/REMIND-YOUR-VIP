import { useEffect, useRef } from "react";

type RainDrop = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  depth: number;
};

const FRAME_MS = 1000 / 60;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function particleCount(width: number, height: number, reducedDensity: boolean) {
  const scale = Math.min(1.35, Math.max(0.58, (width * height) / (1440 * 900)));
  return Math.round(116 * scale * (reducedDensity ? 0.56 : 1));
}

function resetDrop(drop: RainDrop, width: number, height: number, initial = false) {
  drop.vx = randomBetween(-1.35, -0.72);
  drop.vy = randomBetween(7.5, 12.5);
  drop.size = randomBetween(10, 25);
  drop.alpha = randomBetween(0.16, 0.42);
  drop.depth = randomBetween(0.45, 1);
  drop.x = randomBetween(0, width + 40);
  drop.y = initial ? randomBetween(0, height) : randomBetween(-70, -8);
}

function createDrops(width: number, height: number, reducedDensity: boolean) {
  return Array.from({ length: particleCount(width, height, reducedDensity) }, () => {
    const drop = {} as RainDrop;
    resetDrop(drop, width, height, true);
    return drop;
  });
}

/** A continuous canvas particle field adapted from the VPS “细雨” effect. */
export function AmbientRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let drops: RainDrop[] = [];
    let frame = 0;
    let lastTime = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, bounds.width);
      const nextHeight = Math.max(1, bounds.height);
      const changed = Math.abs(nextWidth - width) >= 2 || Math.abs(nextHeight - height) >= 2;
      width = nextWidth;
      height = nextHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.35);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (changed || drops.length === 0) drops = createDrops(width, height, width < 700);
    };

    const draw = (time: number) => {
      const delta = Math.min(2.4, Math.max(0.2, (time - lastTime) / FRAME_MS));
      lastTime = time;
      const dark = document.documentElement.dataset.appearance === "dark";
      context.clearRect(0, 0, width, height);
      context.strokeStyle = dark ? "#bae6fd" : "#475569";
      context.lineCap = "round";
      for (const drop of drops) {
        drop.x += drop.vx * delta;
        drop.y += drop.vy * drop.depth * delta;
        if (drop.y > height + drop.size * 3 || drop.x < -80 || drop.x > width + 80) {
          resetDrop(drop, width, height);
          continue;
        }
        context.globalAlpha = drop.alpha;
        context.lineWidth = drop.depth < 0.68 ? 0.55 : 0.9;
        context.beginPath();
        context.moveTo(drop.x, drop.y);
        context.lineTo(drop.x - drop.size * 0.16, drop.y + drop.size);
        context.stroke();
      }
      context.globalAlpha = 1;
      frame = window.requestAnimationFrame(draw);
    };

    const start = () => {
      if (!frame && !document.hidden) {
        lastTime = performance.now();
        frame = window.requestAnimationFrame(draw);
      }
    };
    const stop = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      lastTime = performance.now();
      start();
    };

    resize();
    start();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      context.clearRect(0, 0, width, height);
    };
  }, []);

  return <canvas ref={canvasRef} className="ambient-effect-layer" data-effect="rain" aria-hidden="true" />;
}
