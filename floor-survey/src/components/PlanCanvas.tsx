import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * A view that survives a change of canvas size -- and a change of plan.
 *
 * Both numbers are deliberately relative to something rather than absolute.
 * `zoom` is a multiple of fit, so a plan stored at 3000 px and the same plan
 * stored at 1500 px are drawn the same size on the page. The centre is a
 * fraction of the image for the same reason: as raw image pixels, a camera
 * set on one level put a different part of the building in the middle of the
 * page on a level whose plan happened to be exported at a different size.
 * Levels of one building must land in exactly the same place on every slide;
 * that is the whole point of locking the view.
 */
export interface PlanCamera {
  /** Centre of the view, as a fraction of the image (0-1). */
  cx: number;
  cy: number;
  /** Multiple of fit-to-view. 1 = exactly fitted. */
  zoom: number;
  /**
   * Set on every camera this component reports. Its absence means a camera
   * saved before cx/cy were fractions, whose numbers are image pixels; those
   * are applied as they were written and are rewritten the first time the
   * plan is moved.
   */
  rel?: boolean;
}

export interface CanvasTransform {
  scale: number;
  tx: number;
  ty: number;
}

interface Props {
  planDataUrl?: string;
  planWidth?: number;
  planHeight?: number;
  /** Draw on top of the plan, in image coordinates (transform applied) */
  drawOverlay?: (ctx: CanvasRenderingContext2D) => void;
  /** Draw AFTER the plan raster (when planOnTop). Same coord space. Use for elements that must sit over walls. */
  drawOverlayTop?: (ctx: CanvasRenderingContext2D) => void;
  /** Tap in image coordinates (single-tap, after gestures settle) */
  onTap?: (x: number, y: number) => void;
  /** Optional badge above canvas */
  badge?: React.ReactNode;
  /** Fill space or use fixed height */
  className?: string;
  /** Called on transform change */
  onTransform?: (t: CanvasTransform) => void;
  /** Optional image-space pointer hooks. Return true from down to consume pan/tap. */
  onImagePointerDown?: (x: number, y: number, event: ReactPointerEvent<HTMLDivElement>) => boolean;
  onImagePointerMove?: (x: number, y: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  onImagePointerUp?: (x: number, y: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Fired when a custom-drag gesture is preempted (e.g. pinch takes over). Consumer should discard drag state without deleting anything. */
  onImagePointerCancel?: (x: number, y: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Plan opacity (only used when planOnTop is false) */
  planOpacity?: number;
  /** Suppress rendering the plan raster (still keeps size) */
  hidePlan?: boolean;
  /** Draw the plan ON TOP of the overlay using multiply blend, so walls stay crisp over color fills */
  planOnTop?: boolean;
  /** When nonce changes, pan (and gently zoom in if too far out) so (x,y) is centered. */
  focusRequest?: { x: number; y: number; nonce: number };
  /**
   * The view, in terms that do not depend on how big this canvas happens to be.
   *
   * scale/tx/ty are wrapper pixels, so the same numbers frame differently in a
   * Floor Survey window, on a report sheet and in a 17 x 11 in PDF. A camera is
   * instead "this image point is in the middle, at this multiple of fit", which
   * reproduces the same framing at any size -- which is what lets one locked
   * view carry from the screen to the page.
   */
  onCamera?: (camera: PlanCamera) => void;
  /** Apply a camera when the nonce changes. Runs after fit, so it wins. */
  cameraRequest?: PlanCamera & { nonce: number };
  /** Keep the current pan/zoom when the wrapper changes size, e.g. mobile keyboard. */
  refitOnResize?: boolean;
  /**
   * Corner grips that resize the drawing.
   *
   * One addition to what this canvas already does, not a replacement for it:
   * pan and wheel zoom stay exactly as they are. Dragging a corner scales the
   * plan about the opposite corner, which gives finer control over the size
   * than the wheel does -- the reason it was asked for.
   */
  resizeCorners?: boolean;
  /**
   * A picture on a page, not a viewport.
   *
   * On a report slide the plan is sized and placed by dragging the frame and
   * its corner, the way a picture is handled in PowerPoint -- so the canvas
   * itself does not pan or zoom, and the plan always fits whatever the frame
   * has been made. Scroll-to-zoom is the wrong gesture there: it navigates a
   * viewport when what is wanted is to resize a picture.
   */
  staticView?: boolean;
  /**
   * Show the view but do not let it be steered.
   *
   * This is what Lock on a report slide needs, and it is deliberately NOT
   * `staticView`: that one also refits the plan whenever the box changes
   * size, which would throw away the very framing Lock was pressed to keep.
   * This only takes the hands off -- no pan, no pinch, no wheel, and no
   * chrome dragging, since those gestures all arrive through these handlers.
   */
  frozen?: boolean;
  /** Optional per-floor plan-image transform (Align mode). Applied to the raster only; points/overlays unchanged. */
  planTransform?: { tx: number; ty: number; scale: number; rotation: number };
}

const IMPLIED_W = 1000;
const IMPLIED_H = 750;

export function PlanCanvas({
  planDataUrl,
  planWidth,
  planHeight,
  drawOverlay,
  drawOverlayTop,
  onTap,
  badge,
  className,
  onTransform,
  onImagePointerDown,
  onImagePointerMove,
  onImagePointerUp,
  onImagePointerCancel,
  planOpacity = 1,
  hidePlan = false,
  planOnTop = false,
  focusRequest,
  onCamera,
  cameraRequest,
  refitOnResize = true,
  staticView = false,
  frozen = false,
  resizeCorners = false,
  planTransform,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [transform, setTransform] = useState<CanvasTransform>({ scale: 1, tx: 0, ty: 0 });
  const [canvasSizeTick, setCanvasSizeTick] = useState(0);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const onTransformRef = useRef(onTransform);
  onTransformRef.current = onTransform;
  const onCameraRef = useRef(onCamera);
  onCameraRef.current = onCamera;

  const imgW = planWidth ?? IMPLIED_W;
  const imgH = planHeight ?? IMPLIED_H;

  useEffect(() => {
    if (!planDataUrl) {
      imgRef.current = null;
      setImgLoaded(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
    img.src = planDataUrl;
  }, [planDataUrl]);

  /** Scale at which the plan exactly fits the current wrapper. */
  const fitScale = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !wrap.clientWidth || !wrap.clientHeight) return 1;
    return Math.min(wrap.clientWidth / imgW, wrap.clientHeight / imgH) || 1;
  }, [imgW, imgH]);

  const applyTransform = useCallback(
    (t: CanvasTransform) => {
      transformRef.current = t;
      setTransform(t);
      onTransformRef.current?.(t);
      const wrap = wrapRef.current;
      if (onCameraRef.current && wrap && t.scale > 0) {
        onCameraRef.current({
          cx: (wrap.clientWidth / 2 - t.tx) / t.scale / (imgW || 1),
          cy: (wrap.clientHeight / 2 - t.ty) / t.scale / (imgH || 1),
          zoom: t.scale / (fitScale() || 1),
          rel: true,
        });
      }
    },
    [fitScale, imgW, imgH],
  );

  // Fit-to-view only on first load/new plan, or when the user taps Fit.
  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    const s = Math.min(cw / imgW, ch / imgH);
    const tx = (cw - imgW * s) / 2;
    const ty = (ch - imgH * s) / 2;
    const t = { scale: s, tx, ty };
    applyTransform(t);
  }, [imgW, imgH, applyTransform]);

  useEffect(() => {
    fit();
  }, [fit, planDataUrl, imgLoaded]);

  // Re-fit when the wrapper resizes (e.g. orientation change phone/tablet)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let lastW = wrap.clientWidth;
    let lastH = wrap.clientHeight;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      // A picture follows its frame exactly, so any change refits; a viewport
      // only refits on a big change, to survive a mobile keyboard.
      if (staticView ? w !== lastW || h !== lastH : Math.abs(w - lastW) > 20 || Math.abs(h - lastH) > 20) {
        lastW = w;
        lastH = h;
        if (staticView || refitOnResize) fit();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, refitOnResize, staticView]);

  // Apply a stored camera. This runs after the fit effect above, so a locked
  // view is not overwritten by the fit that happens when the plan finishes
  // loading. Because the camera is expressed against fit, the same stored
  // numbers frame the same thing whatever size this canvas is.
  const cameraNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!cameraRequest) return;
    if (cameraNonceRef.current === cameraRequest.nonce) return;
    const wrap = wrapRef.current;
    if (!wrap || !wrap.clientWidth || !wrap.clientHeight) return;
    // Wait for the plan, or the fit that runs when it finishes loading would
    // throw the stored view away a moment after it was applied.
    if (planDataUrl && !imgLoaded) return;
    cameraNonceRef.current = cameraRequest.nonce;
    const scale = (cameraRequest.zoom || 1) * (fitScale() || 1);
    // A camera written before the centre became a fraction holds image
    // pixels; it is applied as written rather than silently reinterpreted.
    const cx = cameraRequest.rel ? cameraRequest.cx * imgW : cameraRequest.cx;
    const cy = cameraRequest.rel ? cameraRequest.cy * imgH : cameraRequest.cy;
    const tx = wrap.clientWidth / 2 - cx * scale;
    const ty = wrap.clientHeight / 2 - cy * scale;
    // A stored view that does not actually show the plan is not a view. The
    // report's camera is saved as it is panned and is shared by every Floor
    // Survey slide, so one pan past the edge would otherwise open every slide
    // on blank paper with no way back. If the plan would be entirely off the
    // canvas, fit instead.
    const onScreen =
      tx < wrap.clientWidth &&
      ty < wrap.clientHeight &&
      tx + imgW * scale > 0 &&
      ty + imgH * scale > 0;
    if (!onScreen) {
      fit();
      return;
    }
    applyTransform({ scale, tx, ty });
  }, [cameraRequest, fitScale, applyTransform, fit, imgW, imgH, imgLoaded, canvasSizeTick, planDataUrl]);

  // Programmatic focus: pan (and gently zoom in if too zoomed out) to center (x,y).
  const focusNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focusRequest) return;
    if (focusNonceRef.current === focusRequest.nonce) return;
    focusNonceRef.current = focusRequest.nonce;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    const cur = transformRef.current;
    const fitScale = Math.min(cw / imgW, ch / imgH);
    // Zoom in to at least 1.5x the fit-scale so the point is clearly visible.
    const minScale = fitScale * 1.5;
    const scale = cur.scale < minScale ? minScale : cur.scale;
    const tx = cw / 2 - focusRequest.x * scale;
    const ty = ch / 2 - focusRequest.y * scale;
    applyTransform({ scale, tx, ty });
  }, [focusRequest, applyTransform, imgW, imgH]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setCanvasSizeTick((tick) => tick + 1);
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Render
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(transform.tx, transform.ty);
    ctx.scale(transform.scale, transform.scale);

    // Helper: wrap a plan-image draw call in the optional planTransform
    // (translate + rotate + scale around image center).
    const drawPlanImage = (img: HTMLImageElement, alpha: number) => {
      ctx.save();
      if (planTransform) {
        const cx = imgW / 2;
        const cy = imgH / 2;
        ctx.translate(cx + planTransform.tx, cy + planTransform.ty);
        ctx.rotate(planTransform.rotation);
        ctx.scale(planTransform.scale, planTransform.scale);
        ctx.translate(-cx, -cy);
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, 0, 0, imgW, imgH);
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    // Plan bounds — under the overlay UNLESS planOnTop
    if (!hidePlan && !planOnTop) {
      if (imgLoaded && imgRef.current) {
        drawPlanImage(imgRef.current, planOpacity);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, imgW, imgH);
        ctx.strokeStyle = "#e5e0d5";
        ctx.lineWidth = 2 / transform.scale;
        ctx.strokeRect(0, 0, imgW, imgH);
      }
    } else if (!hidePlan && planOnTop && (!imgLoaded || !imgRef.current)) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, imgW, imgH);
    }

    if (drawOverlay) drawOverlay(ctx);

    // Plan on top: multiply blend keeps walls crisp while white paper reveals color underneath
    if (!hidePlan && planOnTop && imgLoaded && imgRef.current) {
      ctx.globalCompositeOperation = "multiply";
      drawPlanImage(imgRef.current, 1);
      ctx.globalCompositeOperation = "source-over";
    }

    // Overlay that must sit above walls (points, labels, pins, legend)
    if (drawOverlayTop) drawOverlayTop(ctx);

    ctx.restore();
  }, [
    transform,
    canvasSizeTick,
    imgLoaded,
    imgW,
    imgH,
    drawOverlay,
    drawOverlayTop,
    planOpacity,
    hidePlan,
    planOnTop,
    planTransform,
  ]);

  useEffect(() => {
    render();
  });

  // --- Pointer / gesture handling ---
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureStart = useRef<{
    dist: number;
    mid: { x: number; y: number };
    transform: CanvasTransform;
  } | null>(null);
  const singleStart = useRef<{ x: number; y: number; t0: number; moved: boolean } | null>(null);
  const customPointer = useRef<number | null>(null);

  function toImage(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const t = transformRef.current;
    return { x: (localX - t.tx) / t.scale, y: (localY - t.ty) / t.scale };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // If a second finger arrives while a custom (point-drag) gesture is active,
    // cancel the custom drag and hand ALL pointers over to pinch/pan so the
    // user can always zoom regardless of where their first finger landed.
    if (customPointer.current !== null && pointers.current.size >= 1) {
      const img = toImage(e.clientX, e.clientY);
      onImagePointerCancel?.(img.x, img.y, e);
      customPointer.current = null;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gestureStart.current = { dist, mid, transform: transformRef.current };
      singleStart.current = null;
      return;
    }
    if (onImagePointerDown) {
      const img = toImage(e.clientX, e.clientY);
      if (onImagePointerDown(img.x, img.y, e)) {
        customPointer.current = e.pointerId;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      singleStart.current = { x: e.clientX, y: e.clientY, t0: performance.now(), moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gestureStart.current = { dist, mid, transform: transformRef.current };
      singleStart.current = null;
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    if (customPointer.current === e.pointerId) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const img = toImage(e.clientX, e.clientY);
      onImagePointerMove?.(img.x, img.y, e);
      return;
    }
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && gestureStart.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const g = gestureStart.current;
      const rect = wrapRef.current!.getBoundingClientRect();
      const scale = g.transform.scale * (dist / g.dist);
      // keep the pinch midpoint stationary
      const originalMidLocal = { x: g.mid.x - rect.left, y: g.mid.y - rect.top };
      const newMidLocal = { x: mid.x - rect.left, y: mid.y - rect.top };
      const imgX = (originalMidLocal.x - g.transform.tx) / g.transform.scale;
      const imgY = (originalMidLocal.y - g.transform.ty) / g.transform.scale;
      const tx = newMidLocal.x - imgX * scale;
      const ty = newMidLocal.y - imgY * scale;
      const t = { scale: Math.max(0.05, Math.min(20, scale)), tx, ty };
      applyTransform(t);
    } else if (pointers.current.size === 1 && singleStart.current) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      const total = Math.hypot(
        e.clientX - singleStart.current.x,
        e.clientY - singleStart.current.y,
      );
      if (total > 6) singleStart.current.moved = true;
      if (singleStart.current.moved) {
        const t = {
          scale: transformRef.current.scale,
          tx: transformRef.current.tx + dx,
          ty: transformRef.current.ty + dy,
        };
        applyTransform(t);
      }
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (customPointer.current === e.pointerId) {
      const img = toImage(e.clientX, e.clientY);
      onImagePointerUp?.(img.x, img.y, e);
      customPointer.current = null;
      pointers.current.delete(e.pointerId);
      singleStart.current = null;
      return;
    }
    const wasSingle = pointers.current.size === 1 && singleStart.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gestureStart.current = null;
    if (wasSingle && singleStart.current && !singleStart.current.moved && onTap) {
      const rect = wrapRef.current!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const t = transformRef.current;
      const x = (localX - t.tx) / t.scale;
      const y = (localY - t.ty) / t.scale;
      onTap(x, y);
    }
    singleStart.current = null;
  }

  function onPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    if (customPointer.current === e.pointerId) {
      const img = toImage(e.clientX, e.clientY);
      onImagePointerCancel?.(img.x, img.y, e);
      customPointer.current = null;
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gestureStart.current = null;
    singleStart.current = null;
  }

  // Corner resize. Scales about the OPPOSITE corner, so the corner being held
  // is the one that moves and the drawing grows or shrinks from the other.
  const cornerDrag = useRef<
    | {
        pointerId: number;
        corner: "nw" | "ne" | "sw" | "se";
        anchorX: number;
        anchorY: number;
        imgX: number;
        imgY: number;
        startDist: number;
        startScale: number;
      }
    | null
  >(null);

  function cornerPointerDown(
    corner: "nw" | "ne" | "sw" | "se",
    e: ReactPointerEvent<HTMLSpanElement>,
  ) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = wrap.getBoundingClientRect();
    const t = transformRef.current;
    // The grips belong to the PLAN, so the corner that stays still is the
    // plan's opposite corner -- not the opposite corner of the canvas. Anchored
    // to the canvas, resizing dragged the plan around relative to the page,
    // which is not what grabbing a picture's corner does.
    const imgX = corner === "nw" || corner === "sw" ? imgW : 0;
    const imgY = corner === "nw" || corner === "ne" ? imgH : 0;
    const anchorX = t.tx + imgX * t.scale;
    const anchorY = t.ty + imgY * t.scale;
    const dist = Math.hypot(e.clientX - (rect.left + anchorX), e.clientY - (rect.top + anchorY));
    cornerDrag.current = {
      pointerId: e.pointerId,
      corner,
      anchorX,
      anchorY,
      imgX,
      imgY,
      startDist: Math.max(1, dist),
      startScale: t.scale,
    };
    try {
      (e.currentTarget as HTMLSpanElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is a convenience */
    }
  }

  function cornerPointerMove(e: ReactPointerEvent<HTMLSpanElement>) {
    const d = cornerDrag.current;
    const wrap = wrapRef.current;
    if (!d || !wrap || d.pointerId !== e.pointerId) return;
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const dist = Math.hypot(
      e.clientX - (rect.left + d.anchorX),
      e.clientY - (rect.top + d.anchorY),
    );
    const next = Math.max(0.05, Math.min(20, d.startScale * (dist / d.startDist)));
    applyTransform({
      scale: next,
      tx: d.anchorX - d.imgX * next,
      ty: d.anchorY - d.imgY * next,
    });
  }

  function cornerPointerUp(e: ReactPointerEvent<HTMLSpanElement>) {
    if (cornerDrag.current && cornerDrag.current.pointerId === e.pointerId) {
      cornerDrag.current = null;
    }
  }

  // wheel zoom for desktop
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const t = transformRef.current;
    const newScale = Math.max(0.05, Math.min(20, t.scale * factor));
    const imgX = (localX - t.tx) / t.scale;
    const imgY = (localY - t.ty) / t.scale;
    const nt = { scale: newScale, tx: localX - imgX * newScale, ty: localY - imgY * newScale };
    applyTransform(nt);
  }

  return (
    <div className={className ?? "relative flex-1 min-h-0"}>
      {badge}
      <div
        ref={wrapRef}
        data-floor-viewport=""
        data-canvas-scale={transform.scale}
        data-canvas-tx={transform.tx}
        data-canvas-ty={transform.ty}
        className="absolute inset-0 touch-none overflow-hidden select-none"
        onPointerDown={staticView || frozen ? undefined : onPointerDown}
        onPointerMove={staticView || frozen ? undefined : onPointerMove}
        onPointerUp={staticView || frozen ? undefined : onPointerUp}
        onPointerCancel={staticView || frozen ? undefined : onPointerCancel}
        onWheel={staticView || frozen ? undefined : onWheel}
        style={{ cursor: staticView || frozen ? "default" : "crosshair" }}
      >
        <canvas ref={canvasRef} />
      </div>
      {resizeCorners &&
        (["nw", "ne", "sw", "se"] as const).map((corner) => {
          // The grips sit on the PLAN's own corners and travel with it when it
          // is panned or zoomed, rather than sitting at the corners of the
          // canvas. The wrapper is inset-0 inside this box, so the transform's
          // local coordinates are this box's coordinates.
          const left =
            transform.tx + (corner === "ne" || corner === "se" ? imgW * transform.scale : 0);
          const top =
            transform.ty + (corner === "sw" || corner === "se" ? imgH * transform.scale : 0);
          return (
            <span
              key={corner}
              data-plan-resize={corner}
              onPointerDown={(e) => cornerPointerDown(corner, e)}
              onPointerMove={cornerPointerMove}
              onPointerUp={cornerPointerUp}
              onPointerCancel={cornerPointerUp}
              className={
                "absolute z-30 h-4 w-4 rounded-sm border border-slate-600 bg-white shadow touch-none " +
                (corner === "nw" || corner === "se"
                  ? "cursor-nwse-resize"
                  : "cursor-nesw-resize")
              }
              // Tucked just inside the plan's corner rather than centred on
              // it: a grip straddling the corner has half its area outside the
              // drawing, where the slide's chrome overlays sit on top, and the
              // bottom pair then could not be grabbed at all.
              style={{
                left,
                top,
                transform: `translate(${corner === "ne" || corner === "se" ? "-100%" : "0"}, ${
                  corner === "sw" || corner === "se" ? "-100%" : "0"
                })`,
              }}
            />
          );
        })}
    </div>
  );
}
