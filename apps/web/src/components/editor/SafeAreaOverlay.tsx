/**
 * SafeAreaOverlay
 *
 * SVG overlay that renders on top of any preview canvas to visualise
 * a social-platform's safe zone and UI zones.
 *
 * Positioning:
 *   Place the overlay as an absolutely-positioned sibling of the canvas
 *   with width="100%" height="100%". The viewBox maps to the logical
 *   frame dimensions (width × height) so all normalised coordinates
 *   scale correctly without JS math.
 *
 * Usage:
 *   <div style={{ position: "relative" }}>
 *     <canvas ... />
 *     <SafeAreaOverlay spec={SOCIAL_PLATFORM_SPECS.tiktok} />
 *   </div>
 */

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { SocialPlatformSpec } from "@openreel/core";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SafeAreaOverlayProps {
  spec: SocialPlatformSpec;
  /** If false the overlay is hidden (toggle state lives outside) */
  visible?: boolean;
  /** Show the toggle button inside the overlay */
  showToggle?: boolean;
  /** Show subtitle position guide line */
  showSubtitleGuide?: boolean;
  /** Custom CSS class added to the root <svg> */
  className?: string;
  /** Opacity for the UI-zone tint (0–1, default 0.55) */
  uiZoneOpacity?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Hatched-fill SVG pattern that marks an unsafe UI zone */
function UiZoneRect({
  x,
  y,
  width,
  height,
  colorHex,
  label,
  opacity,
  patternId,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  colorHex: string;
  label: string;
  opacity: number;
  patternId: string;
}) {
  // Strip alpha from hex for the pattern (SVG uses opacity separately)
  const solidColor = colorHex.slice(0, 7);

  return (
    <g>
      {/* Solid tint */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={solidColor}
        opacity={opacity * 0.55}
      />
      {/* Diagonal stripe pattern */}
      <defs>
        <pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          width="8"
          height="8"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="8"
            stroke={solidColor}
            strokeWidth="2"
            opacity="0.25"
          />
        </pattern>
      </defs>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={`url(#${patternId})`}
        opacity={opacity}
      />
      {/* Zone label — only shown if the strip is tall/wide enough */}
      {(height > 20 || width > 80) && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="11"
          fontFamily="system-ui, sans-serif"
          fontWeight="600"
          opacity="0.85"
        >
          {label}
        </text>
      )}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export const SafeAreaOverlay: React.FC<SafeAreaOverlayProps> = ({
  spec,
  visible = true,
  showToggle = false,
  showSubtitleGuide = true,
  className = "",
  uiZoneOpacity = 0.55,
}) => {
  const [internalVisible, setInternalVisible] = useState(true);
  const isVisible = visible && internalVisible;

  const { width: W, height: H, safeArea, uiZones, subtitleHint, color } = spec;

  // Safe zone rect in logical px
  const sz = {
    x: safeArea.left * W,
    y: safeArea.top * H,
    width: W * (1 - safeArea.left - safeArea.right),
    height: H * (1 - safeArea.top - safeArea.bottom),
  };

  // Subtitle guide Y (normalised top-to-bottom)
  const safeBottom = (1 - safeArea.bottom) * H;
  const safeHeight = H * (1 - safeArea.top - safeArea.bottom);
  const subtitleY =
    safeBottom - safeHeight * subtitleHint.safeZoneBottomOffset;

  // Render each UI zone into pixel coords
  const zoneRects = uiZones.map((zone, idx) => {
    let x = 0,
      y = 0,
      zoneW = W,
      zoneH = H;
    switch (zone.edge) {
      case "top":
        zoneH = zone.size * H;
        break;
      case "bottom":
        y = H - zone.size * H;
        zoneH = zone.size * H;
        break;
      case "left":
        zoneW = zone.size * W;
        break;
      case "right":
        x = W - zone.size * W;
        zoneW = zone.size * W;
        break;
    }
    return { x, y, width: zoneW, height: zoneH, zone, idx };
  });

  return (
    <div
      className={`absolute inset-0 pointer-events-none select-none ${className}`}
      style={{ zIndex: 10 }}
    >
      {showToggle && (
        <button
          onClick={() => setInternalVisible((v) => !v)}
          title={internalVisible ? "Ocultar safe area" : "Mostrar safe area"}
          className="pointer-events-auto absolute top-2 right-2 z-20 flex items-center gap-1 px-2 py-1 rounded bg-black/60 text-white text-[10px] hover:bg-black/80 transition-colors"
        >
          {internalVisible ? <EyeOff size={11} /> : <Eye size={11} />}
          Safe Area
        </button>
      )}

      {isVisible && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* ── UI zone overlays ───────────────────────────────────────── */}
          {zoneRects.map(({ x, y, width, height, zone, idx }) => (
            <UiZoneRect
              key={idx}
              x={x}
              y={y}
              width={width}
              height={height}
              colorHex={zone.colorHex}
              label={zone.label}
              opacity={uiZoneOpacity}
              patternId={`zone-pattern-${spec.id}-${idx}`}
            />
          ))}

          {/* ── Safe zone outline ──────────────────────────────────────── */}
          <rect
            x={sz.x}
            y={sz.y}
            width={sz.width}
            height={sz.height}
            fill="none"
            stroke="#22c55e"
            strokeWidth="2.5"
            strokeDasharray="10 4"
            opacity="0.85"
          />

          {/* Corner ticks for the safe zone */}
          {[
            [sz.x, sz.y],                          // top-left
            [sz.x + sz.width, sz.y],               // top-right
            [sz.x, sz.y + sz.height],              // bottom-left
            [sz.x + sz.width, sz.y + sz.height],   // bottom-right
          ].map(([cx, cy], i) => {
            const arm = 18;
            const dxSign = i % 2 === 0 ? 1 : -1;  // left cols go right, right cols go left
            const dySign = i < 2 ? 1 : -1;          // top rows go down, bottom rows go up
            return (
              <g key={i}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={cx + dxSign * arm}
                  y2={cy}
                  stroke="#22c55e"
                  strokeWidth="3"
                  opacity="1"
                />
                <line
                  x1={cx}
                  y1={cy}
                  x2={cx}
                  y2={cy + dySign * arm}
                  stroke="#22c55e"
                  strokeWidth="3"
                  opacity="1"
                />
              </g>
            );
          })}

          {/* ── "SAFE ZONE" label ──────────────────────────────────────── */}
          <text
            x={sz.x + 6}
            y={sz.y + 16}
            fill="#22c55e"
            fontSize="11"
            fontFamily="system-ui, monospace"
            fontWeight="700"
            opacity="0.9"
          >
            SAFE ZONE
          </text>

          {/* ── Subtitle guide line ────────────────────────────────────── */}
          {showSubtitleGuide && (
            <g>
              <line
                x1={sz.x + 10}
                y1={subtitleY}
                x2={sz.x + sz.width - 10}
                y2={subtitleY}
                stroke="#60a5fa"
                strokeWidth="2"
                strokeDasharray="6 3"
                opacity="0.8"
              />
              {/* Subtitle label */}
              <rect
                x={sz.x + sz.width / 2 - 52}
                y={subtitleY - 14}
                width={104}
                height={16}
                rx="3"
                fill="#1d4ed8"
                opacity="0.7"
              />
              <text
                x={sz.x + sz.width / 2}
                y={subtitleY - 3}
                textAnchor="middle"
                fill="white"
                fontSize="9"
                fontFamily="system-ui, sans-serif"
                fontWeight="600"
                opacity="0.95"
              >
                SUBTÍTULOS AQUÍ
              </text>
            </g>
          )}

          {/* ── Platform badge ─────────────────────────────────────────── */}
          <g>
            <rect
              x={W - 82}
              y={sz.y + 6}
              width={76}
              height={20}
              rx="4"
              fill={color}
              opacity="0.85"
            />
            <text
              x={W - 44}
              y={sz.y + 20}
              textAnchor="middle"
              fill="white"
              fontSize="10"
              fontFamily="system-ui, sans-serif"
              fontWeight="700"
              opacity="1"
            >
              {spec.emoji} {spec.name}
            </text>
          </g>
        </svg>
      )}
    </div>
  );
};

export default SafeAreaOverlay;
