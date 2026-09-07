import { useEffect, useRef } from "react";

type Point = { x: number; y: number };

/** Theme-aware market canvas. Decorative only; respects reduced-motion. */
export default function CinematicBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, width = 0, height = 0, dpr = 1, raf = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth; height = window.innerHeight;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const dark = document.documentElement.classList.contains("dark");
      const ink = dark ? "255,255,255" : "12,12,14";
      const accent = dark ? "130,205,178" : "24,112,84";
      const tick = reducedMotion.matches ? 0 : frame;
      ctx.clearRect(0, 0, width, height);
      const glow = ctx.createRadialGradient(width * .78, height * .38, 0, width * .78, height * .38, Math.max(width, height) * .45);
      glow.addColorStop(0, `rgba(${accent},${dark ? .09 : .07})`); glow.addColorStop(1, `rgba(${accent},0)`);
      ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = `rgba(${ink},${dark ? .045 : .055})`; ctx.lineWidth = 1;
      const grid = Math.max(44, Math.min(72, width / 20));
      const drift = (tick * .06) % grid;
      for (let x = -grid + drift; x < width + grid; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = -grid; y < height + grid; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

      const left = width < 768 ? width * .08 : width * .47;
      const right = width * .96, center = height * .45, amplitude = Math.min(150, height * .18);
      const points: Point[] = [];
      const count = Math.max(18, Math.floor((right - left) / 38));
      for (let i = 0; i <= count; i++) {
        const progress = i / count;
        const trend = amplitude * (.42 - progress * .7);
        const wave = Math.sin(i * .82 + tick * .008) * amplitude * .18 + Math.sin(i * .27) * amplitude * .22;
        points.push({ x: left + progress * (right - left), y: center + trend + wave });
      }
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = `rgba(${accent},${dark ? .72 : .58})`; ctx.lineWidth = 1.5; ctx.stroke();
      points.slice(1).forEach((point, i) => {
        if (i % 2) return;
        const rising = point.y < points[i].y;
        const candleHeight = 12 + Math.abs(point.y - points[i].y) * .65;
        ctx.strokeStyle = rising ? `rgba(${accent},.46)` : `rgba(${ink},.22)`;
        ctx.fillStyle = rising ? `rgba(${accent},.18)` : `rgba(${ink},.08)`;
        ctx.beginPath(); ctx.moveTo(point.x, point.y - candleHeight); ctx.lineTo(point.x, point.y + candleHeight); ctx.stroke();
        ctx.fillRect(point.x - 3, point.y - candleHeight * .45, 6, candleHeight * .9);
      });
      const last = points[points.length - 1];
      const pulse = reducedMotion.matches ? 4 : 4 + Math.sin(tick * .06) * 2;
      ctx.beginPath(); ctx.arc(last.x, last.y, pulse, 0, Math.PI * 2); ctx.fillStyle = `rgba(${accent},.85)`; ctx.fill();

      const fade = ctx.createLinearGradient(0, 0, width, 0);
      fade.addColorStop(0, dark ? "rgba(10,10,10,.98)" : "rgba(250,250,250,.98)");
      fade.addColorStop(width < 768 ? .05 : .35, dark ? "rgba(10,10,10,.82)" : "rgba(250,250,250,.82)");
      fade.addColorStop(.72, "rgba(0,0,0,0)"); ctx.fillStyle = fade; ctx.fillRect(0, 0, width, height);
      frame += 1;
      if (!reducedMotion.matches) raf = requestAnimationFrame(draw);
    };

    const observer = new MutationObserver(() => { if (reducedMotion.matches) draw(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    resize(); draw();
    window.addEventListener("resize", resize); reducedMotion.addEventListener("change", draw);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); window.removeEventListener("resize", resize); reducedMotion.removeEventListener("change", draw); };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none opacity-80" style={{ zIndex: 0 }} aria-hidden="true" />;
}
