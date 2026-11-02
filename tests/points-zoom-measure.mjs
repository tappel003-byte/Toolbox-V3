/**
 * Measure capture reading-dot zoom against the live canvas scale.
 * Run: node tests/points-zoom-measure.mjs   (static server on 8765)
 */
import { createRequire } from "module";
import { mkdir, writeFile } from "fs/promises";

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  puppeteer = require("/tmp/node_modules/puppeteer-core");
}

const BASE = "http://127.0.0.1:8765/index.html";
const OUT = "/opt/cursor/artifacts";
const FILE = "cf-points-zoom";
const POINT_SIZE = 6;
const FIT_FACTOR = 0.72;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: "new",
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
await page.setViewport({
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await page.goto(BASE, { waitUntil: "networkidle0" });

const PLAN_W = 900;
const PLAN_H = 700;
await page.evaluate(
  async ({ id, planW, planH, pointSize }) => {
    const canvas = document.createElement("canvas");
    canvas.width = planW;
    canvas.height = planH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e8e4dc";
    ctx.fillRect(0, 0, planW, planH);
    await window.ToolboxDB.putMedia("plan-points-zoom", canvas.toDataURL("image/png"));

    const record = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(record);
    record.firstName = "Points";
    record.lastName = "Zoom";
    const canvasId = "canvas-points-zoom";
    const now = new Date().toISOString();
    record.planSetup.canvases = [
      {
        id: canvasId,
        name: "Main Level",
        createdAt: now,
        updatedAt: now,
        plan: { id: "plan-points-zoom", width: planW, height: planH },
        rooms: [],
        frontDoorFacing: "S",
        frontDoor: null,
      },
    ];
    record.planSetup.activeCanvasId = canvasId;
    window.ToolboxPlanSetup.ensureFloorSurvey(record);
    window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(record, canvasId);
    const poly = [
      { x: 80, y: 80 },
      { x: 820, y: 80 },
      { x: 820, y: 620 },
      { x: 80, y: 620 },
    ];
    record.floorSurvey.byCanvasId[canvasId] = {
      canvasId,
      boundary: poly,
      areas: [{ id: "area-a", name: "Boundary 1", polygon: poly, createdAt: 1 }],
      points: [
        { id: "p1", floorId: canvasId, index: 1, x: 300, y: 280, value: 9.6, createdAt: 1 },
        { id: "p2", floorId: canvasId, index: 2, x: 450, y: 350, value: 9.2, createdAt: 1 },
        { id: "p3", floorId: canvasId, index: 3, x: 600, y: 420, value: 8.7, createdAt: 1 },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    localStorage.setItem(`dpp-size:${id}`, String(pointSize));
    localStorage.setItem(`dpp-color:${id}`, "#111827");
    await window.ToolboxDB.saveCustomerFile(record);
  },
  { id: FILE, planW: PLAN_W, planH: PLAN_H, pointSize: POINT_SIZE },
);

await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: "networkidle0" });
await page.waitForFunction(
  () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Topo"),
  { timeout: 20000 },
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => (b.textContent || "").trim() === "Topo")
    ?.click();
});
await new Promise((r) => setTimeout(r, 1400));

// Readings → Show labels off, High/low off, Contours off — dots only on a quiet plan.
await page.evaluate(() => {
  document.querySelector('[aria-label="Control panel"]')?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const clickTab = (name) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === name,
    );
    btn?.click();
  };
  clickTab("Contours");
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  // Turn off filled contours / lines if switches are labeled.
  const switches = [...document.querySelectorAll('button[role="switch"], [role="switch"]')];
  for (const sw of switches) {
    const row = sw.closest("div");
    const label = (row?.textContent || "").toLowerCase();
    if (
      (label.includes("contour") || label.includes("fill") || label.includes("colour") || label.includes("color")) &&
      sw.getAttribute("aria-checked") === "true"
    ) {
      sw.click();
    }
  }
});
await page.evaluate(() => {
  const clickTab = (name) => {
    [...document.querySelectorAll("button")]
      .find((b) => (b.textContent || "").trim() === name)
      ?.click();
  };
  clickTab("Readings");
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const switches = [...document.querySelectorAll('button[role="switch"], [role="switch"]')];
  for (const sw of switches) {
    const row = sw.closest("div");
    const label = (row?.textContent || "").toLowerCase();
    if (label.includes("label") && sw.getAttribute("aria-checked") === "true") sw.click();
  }
});
await page.evaluate(() => {
  const clickTab = (name) => {
    [...document.querySelectorAll("button")]
      .find((b) => (b.textContent || "").trim() === name)
      ?.click();
  };
  clickTab("Accessories");
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const switches = [...document.querySelectorAll('button[role="switch"], [role="switch"]')];
  for (const sw of switches) {
    const row = sw.closest("div");
    const label = (row?.textContent || "").toLowerCase();
    if (label.includes("high") && sw.getAttribute("aria-checked") === "true") sw.click();
  }
});
// Close panel
await page.evaluate(() => {
  document.querySelector('[aria-label="Close"]')?.click();
  const x = [...document.querySelectorAll("button")].find((b) =>
    /close/i.test(b.getAttribute("aria-label") || ""),
  );
  x?.click();
});
await new Promise((r) => setTimeout(r, 500));

async function canvasScale() {
  return page.evaluate(() => {
    const el = document.querySelector("[data-floor-viewport]");
    if (!el) return null;
    return { scale: Number(el.getAttribute("data-canvas-scale")) };
  });
}

async function measureDotCss() {
  return page.evaluate(() => {
    const el = document.querySelector("[data-floor-viewport]");
    const c = el?.querySelector("canvas");
    if (!c) return null;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const { width: w, height: h } = c;
    const data = ctx.getImageData(0, 0, w, h).data;
    const dark = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 200) continue;
        if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) dark.push({ x, y });
      }
    }
    if (dark.length < 3) return { error: "no-dark", count: dark.length };
    // Largest compact cluster (one of the reading dots).
    let best = null;
    const used = new Set();
    const key = (p) => `${p.x},${p.y}`;
    const set = new Set(dark.map(key));
    for (const seed of dark) {
      if (used.has(key(seed))) continue;
      const cluster = [];
      const queue = [seed];
      const seen = new Set([key(seed)]);
      while (queue.length) {
        const p = queue.pop();
        cluster.push(p);
        used.add(key(p));
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const n = { x: p.x + dx, y: p.y + dy };
            const k = key(n);
            if (seen.has(k) || !set.has(k)) continue;
            seen.add(k);
            queue.push(n);
          }
        }
      }
      if (!best || cluster.length > best.pixels) {
        const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
        const cy = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
        let maxR = 0;
        for (const p of cluster) maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
        best = { pixels: cluster.length, deviceRadius: maxR, cx, cy };
      }
    }
    const rect = c.getBoundingClientRect();
    return {
      ...best,
      cssRadius: best.deviceRadius * (rect.width / w),
      dark: dark.length,
    };
  });
}

const atFit = await canvasScale();
const fitScale = atFit?.scale;
check("fit scale is available", !!(fitScale > 0), JSON.stringify(atFit));

const fitShot = `${OUT}/points-zoom-fit.png`;
await page.screenshot({ path: fitShot, fullPage: false });
const fitDot = await measureDotCss();
check("fit view has a measurable black dot", !!(fitDot && fitDot.cssRadius > 0), JSON.stringify(fitDot));

// ~2× zoom (not slam into the 20× clamp).
for (let i = 0; i < 5; i += 1) {
  await page.evaluate(() => {
    const el = document.querySelector("[data-floor-viewport]");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaY: -140,
      }),
    );
  });
  await new Promise((r) => setTimeout(r, 150));
}

const zoomed = await canvasScale();
const scaleRatio = zoomed && fitScale ? zoomed.scale / fitScale : 0;
check(
  "wheel zoom increased data-canvas-scale by at least 1.5×",
  scaleRatio >= 1.5,
  JSON.stringify({ atFit, zoomed, scaleRatio }),
);

const zoomShot = `${OUT}/points-zoom-in.png`;
await page.screenshot({ path: zoomShot, fullPage: false });
const zoomDot = await measureDotCss();
check("zoomed view has a measurable black dot", !!(zoomDot && zoomDot.cssRadius > 0), JSON.stringify(zoomDot));

const imgR = (POINT_SIZE * FIT_FACTOR) / fitScale;
const expectedFitCss = imgR * fitScale;
const expectedZoomCss = imgR * (zoomed?.scale || 0);

if (fitDot?.cssRadius > 0 && zoomDot?.cssRadius > 0 && scaleRatio >= 1.5) {
  const dotRatio = zoomDot.cssRadius / fitDot.cssRadius;
  check(
    "on-screen dot radius tracks canvas scale (within 30%)",
    Math.abs(dotRatio / scaleRatio - 1) <= 0.3 && dotRatio >= 1.35,
    JSON.stringify({
      scaleRatio,
      dotRatio,
      fitCss: fitDot.cssRadius,
      zoomCss: zoomDot.cssRadius,
      expectedFitCss,
      expectedZoomCss,
      measuredVsExpectedFit: fitDot.cssRadius / expectedFitCss,
      measuredVsExpectedZoom: zoomDot.cssRadius / expectedZoomCss,
    }),
  );
}

await writeFile(
  `${OUT}/points-zoom-measure.json`,
  JSON.stringify(
    {
      atFit,
      zoomed,
      scaleRatio,
      fitDot,
      zoomDot,
      expectedFitCss,
      expectedZoomCss,
      fitShot,
      zoomShot,
      POINT_SIZE,
    },
    null,
    2,
  ),
);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
