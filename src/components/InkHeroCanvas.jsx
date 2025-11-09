// src/components/InkHeroCanvas.jsx 
// Animated hero background using canvas to draw fluid gradient blobs and overlap waves.

import React, { useRef, useEffect } from "react";

/** InkHeroCanvas — liquid blobs with overlap waves (no-freeze on scroll) */
export default function InkHeroCanvas({ className = "" }) {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);

    useEffect(() => {
        const rootStyles = getComputedStyle(document.documentElement);
        const heroGrad = rootStyles.getPropertyValue("--hero-grad").trim();
        // parse linear-gradient into color stops
        function parseLinearGradient(str) {
            const match = str.match(/linear-gradient\([^,]+,(.+)\)/i);
            if (!match) return [];
            return match[1].split(",").map(s => s.trim().split(" ")[0]); // just colors
        }
        const heroColors = parseLinearGradient(heroGrad);
        // fallback if parsing fails
        if (heroColors.length < 2) {
            heroColors.splice(0, heroColors.length, "#8A5BFF", "#FF914D", "#FF4DB8");
        }

        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return;

        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return;

        // ===== Visual tunables (yours) =====
        const DPR_CAP = 1.6;
        const OPACITY = 0.9;
        const HAZE = 0.05;
        const SPREAD = 0.6;
        const RIPPLE1 = 0.09;
        const RIPPLE2 = 0.05;
        const SPEED = 0.12;
        const ROT_SPEED_1 = 0.05;
        const ROT_SPEED_2 = -0.04;

        // Overlap waves
        const WAVE_SPACING = 18;
        const WAVE_WIDTH = 2.2;
        const WAVE_AMP = 10;
        const WAVE_FREQ = 0.018;
        const WAVE_SPEED = 0.55;
        const WAVE_ALPHA = 0.14;
        const WAVE_RIM_ALPHA = 0.18;
        // ===================================

        // ---- runtime state ----
        let w = 0, h = 0;
        let dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        let raf = 0;
        let running = false;
        let isVisible = false;
        let scrollBoost = false;
        let currentSteps = 150;

        const prefersReduced =
            window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        // ---- sizing (debounced) ----
        let resizeTO = 0;
        const resize = () => {
            const r = wrap.getBoundingClientRect();
            w = Math.max(1, Math.floor(r.width));
            h = Math.max(1, Math.floor(r.height));
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        const resizeDebounced = () => {
            clearTimeout(resizeTO);
            resizeTO = setTimeout(resize, 60);
        };
        resize();

        // ---- adaptive smoothness ----
        const baseSteps = () => {
            const m = Math.min(w, h);
            return m < 360 ? 110 : m < 640 ? 130 : 160;
        };
        currentSteps = baseSteps();

        // ---- helpers ----
        const t0 = performance.now();

        const pathBlob = (cx, cy, R, t, rot) => {
            ctx.beginPath();
            for (let i = 0; i <= currentSteps; i++) {
                const u = i / currentSteps;
                const ang = u * Math.PI * 2 + rot;
                const r =
                    R *
                    (1 +
                        RIPPLE1 * Math.sin(2 * ang + 0.7 * t) +
                        RIPPLE2 * Math.sin(3 * ang - 0.9 * t));
                const x = cx + r * Math.cos(ang);
                const y = cy + r * Math.sin(ang);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
        };

        const fillRadial = (cx, cy, R, c0, c1) => {
            const g = ctx.createRadialGradient(cx, cy, R * 0.06, cx, cy, R);
            g.addColorStop(0.0, c0);
            g.addColorStop(0.55, c1);
            g.addColorStop(1.0, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.fill();
        };

        const drawOverlapWaves = (cx1, cy1, cx2, cy2, R, t) => {
            ctx.save();
            pathBlob(cx1, cy1, R, t * 6.0, t * ROT_SPEED_1);
            ctx.clip();
            pathBlob(cx2, cy2, R, t * 6.0 + Math.PI * 0.5, t * ROT_SPEED_2);
            ctx.clip();

            const ax = cx2 - cx1;
            const ay = cy2 - cy1;
            const axisAng = Math.atan2(ay, ax);
            const perpAng = axisAng + Math.PI / 2;
            const L = Math.hypot(ax, ay) + R * 2;

            const step = 18;
            const steps = Math.ceil((L * 2) / step);

            const waveWidth = scrollBoost ? WAVE_WIDTH * 0.8 : WAVE_WIDTH;
            const waveAlpha = scrollBoost ? WAVE_ALPHA * 0.7 : WAVE_ALPHA;

            ctx.globalAlpha = waveAlpha;
            ctx.globalCompositeOperation = "overlay";
            ctx.lineWidth = waveWidth;
            ctx.lineCap = "round";

            const bandGrad = ctx.createLinearGradient(
                0, 0,
                Math.cos(perpAng) * 200, Math.sin(perpAng) * 200
            );
            bandGrad.addColorStop(0, "rgba(255,255,255,0.9)");
            bandGrad.addColorStop(1, "rgba(255,255,255,0.2)");
            ctx.strokeStyle = bandGrad;

            const phase = t * WAVE_SPEED * 2 * Math.PI;
            const span = R * 2 + Math.hypot(ax, ay);
            const bands = Math.ceil(span / WAVE_SPACING);
            const offset0 = -((bands - 1) * WAVE_SPACING) / 2;

            for (let b = 0; b < bands; b++) {
                const s = offset0 + b * WAVE_SPACING;
                const mx = (cx1 + cx2) / 2 + Math.cos(axisAng) * s;
                const my = (cy1 + cy2) / 2 + Math.sin(axisAng) * s;

                ctx.beginPath();
                for (let i = -steps; i <= steps; i++) {
                    const u = (i / steps) * L;
                    const bx = mx + Math.cos(perpAng) * u;
                    const by = my + Math.sin(perpAng) * u;
                    const disp = WAVE_AMP * Math.sin(u * WAVE_FREQ + phase + b * 0.35);
                    const px = bx + Math.cos(axisAng) * disp;
                    const py = by + Math.sin(axisAng) * disp;
                    if (i === -steps) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();

                // thin bright rim
                ctx.save();
                ctx.globalAlpha = WAVE_RIM_ALPHA * (scrollBoost ? 0.6 : 1);
                ctx.globalCompositeOperation = "screen";
                ctx.lineWidth = Math.max(1, waveWidth * 0.65);
                ctx.strokeStyle = "rgba(255,255,255,1)";
                ctx.stroke();
                ctx.restore();
            }

            ctx.restore();
        };

        const draw = (now) => {
            if (!running || prefersReduced) return;

            // adapt steps with scrollBoost
            const bs = baseSteps();
            currentSteps = scrollBoost ? Math.floor(bs * 0.7) : bs;

            const s = ((now - t0) / 1000) * SPEED;
            ctx.clearRect(0, 0, w, h);

            const R = Math.max(w, h) * SPREAD;

            const cx1 = w * 0.32 + Math.sin(s * 0.8) * (w * 0.03);
            const cy1 = h * 0.40 + Math.cos(s * 0.6) * (h * 0.03);
            const cx2 = w * 0.68 + Math.sin(s * 0.7) * (w * -0.03);
            const cy2 = h * 0.60 + Math.cos(s * 0.5) * (h * 0.025);

            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = OPACITY;

            pathBlob(cx1, cy1, R, s, s * ROT_SPEED_1);
            fillRadial(cx1, cy1, R, heroColors[0], heroColors[1] || heroColors[0]);

            pathBlob(cx2, cy2, R, s + Math.PI * 0.5, s * ROT_SPEED_2);
            fillRadial(cx2, cy2, R, heroColors[heroColors.length - 2] || heroColors[0], heroColors[heroColors.length - 1] || heroColors[1]);

            drawOverlapWaves(cx1, cy1, cx2, cy2, R, s);

            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = HAZE;
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, w, h);

            raf = requestAnimationFrame(draw);
        };

        // ---- control (start/stop) ----
        const start = () => {
            if (running || prefersReduced) return;
            running = true;
            raf = requestAnimationFrame(draw);
        };
        const stop = () => {
            running = false;
            cancelAnimationFrame(raf);
        };

        // IntersectionObserver: start/stop immediately based on visibility
        const io = new IntersectionObserver(
            (entries) => {
                isVisible = entries.some((e) => e.isIntersecting);
                if (isVisible) {
                    resize(); // ensure correct backing store
                    start();  // start right away (no idle deferral)
                } else {
                    stop();
                }
            },
            { root: null, threshold: [0, 0.01, 0.1, 0.25] }
        );
        io.observe(wrap);

        // Pause when tab hidden; resume on focus if visible
        const onVisibility = () => {
            if (document.hidden) stop();
            else if (isVisible) start();
        };
        document.addEventListener("visibilitychange", onVisibility);

        const onFocus = () => { if (isVisible) start(); };
        const onBlur = () => { stop(); };
        window.addEventListener("focus", onFocus);
        window.addEventListener("blur", onBlur);

        // Lighten frames while actively scrolling
        let scrollTO = 0;
        const onScroll = () => {
            scrollBoost = true;
            clearTimeout(scrollTO);
            scrollTO = setTimeout(() => (scrollBoost = false), 140);
        };
        window.addEventListener("scroll", onScroll, { passive: true });

        // ResizeObserver (debounced)
        const RO = window.ResizeObserver || null;
        const ro = RO ? new RO(resizeDebounced) : null;
        if (ro) ro.observe(wrap);
        else window.addEventListener("resize", resizeDebounced);

        // DPR changes
        let dprMQ, onDpr;
        if (window.matchMedia) {
            dprMQ = window.matchMedia(`(resolution: ${Math.round(dpr * 96)}dpi)`);
            onDpr = () => {
                dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
                resize();
            };
            if (dprMQ.addEventListener) dprMQ.addEventListener("change", onDpr);
            else if (dprMQ.addListener) dprMQ.addListener(onDpr);
        }

        // If already visible at mount, start
        start();

        // ---- cleanup ----
        return () => {
            stop();
            io.disconnect();
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("scroll", onScroll);
            if (ro) ro.disconnect();
            else window.removeEventListener("resize", resizeDebounced);
            if (dprMQ && onDpr) {
                if (dprMQ.removeEventListener) dprMQ.removeEventListener("change", onDpr);
                else if (dprMQ.removeListener) dprMQ.removeListener(onDpr);
            }
        };
    }, []);

    return (
        <div ref={wrapRef} className={className} style={{ position: "absolute", inset: 0 }}>
            <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />
        </div>
    );
}
