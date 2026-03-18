# VideoForge 🎬

> **Fork de [OpenReel Video](https://github.com/Augani/openreel-video) con features de IA integradas: auto-subtítulos Whisper, detector de muletillas en español y presets optimizados para redes sociales.**

VideoForge es un editor de video profesional que corre 100% en el navegador. Construido sobre la base open-source de OpenReel, este fork agrega herramientas impulsadas por IA orientadas a creadores de contenido en español.

**[Demo original](https://openreel.video)** | **[GitHub del autor](https://github.com/devjaime)** | **[Blog](https://jaimehernandez.dev)**

![License](https://img.shields.io/badge/License-MIT-green)
![Fork](https://img.shields.io/badge/Fork-OpenReel-blue)
![AI Features](https://img.shields.io/badge/AI-Whisper%20%2B%20Filler%20Detector-purple)
![Status](https://img.shields.io/badge/Status-Beta-orange)

---

## Features añadidas en este fork

### 🎙️ Auto-subtítulos con Whisper (IA local, sin internet)

Transcripción automática con timestamps por palabra usando Whisper ONNX ejecutado **100% en el navegador**.

- 4 modelos (Tiny 39 MB → Large-v3-Turbo 800 MB)
- 20+ idiomas (español por defecto)
- Animaciones karaoke, word-by-word, typewriter
- Sin servidores — modelo cacheado en IndexedDB
- Panel: `Inspector → Auto-subtítulos IA`

### 🔍 Detector de Muletillas en Español

Analiza la transcripción y detecta 4 categorías:

| Categoría | Ejemplos | Color |
|---|---|---|
| Sonidos | eh, um, mmm, ah, uh | 🔴 Rojo |
| Frases | "o sea", "digamos", "básicamente" | 🟠 Naranja |
| Repeticiones | "que que", "pues pues" | 🟣 Violeta |
| Ambiguas | "entonces", "bueno" (análisis contextual) | 🟡 Amarillo |

Acciones: marcar en timeline, click para navegar, eliminar con ripple-cut, muletillas personalizadas.  
Panel: `Inspector → Detector de Muletillas`

### 📱 Exportación para Redes Sociales

Selector "Exportar para…" con safe areas, guías de subtítulos y encoding optimizado:

| Plataforma | Resolución | FPS | Aspecto |
|---|---|---|---|
| YouTube | 1920×1080 | 30/60 | 16:9 |
| YouTube Shorts | 1080×1920 | 60 | 9:16 |
| TikTok | 1080×1920 | 30/60 | 9:16 |
| Instagram Reels | 1080×1920 | 30 | 9:16 |
| Instagram Feed | 1080×1080 | 30 | 1:1 |
| Instagram Story | 1080×1920 | 30 | 9:16 |
| Twitter/X | 1280×720 | 30 | 16:9 |
| LinkedIn | 1920×1080 | 30 | 16:9 |

Cada preset incluye overlay SVG de safe area, guía de posición de subtítulos, tips de la plataforma y botón "Adaptar canvas".  
Panel: `Export Dialog → Exportar para…`

---

## Instalación y ejecución local

### Requisitos

- **Node.js** ≥ 18.0.0
- **pnpm** ≥ 9.0.0
- **Chrome o Edge 94+** (necesario para WebCodecs en la exportación)

```bash
# 1. Instalar pnpm si no lo tienes
npm install -g pnpm

# 2. Clonar el repositorio
git clone https://github.com/devjaime/videoforge.git
cd videoforge

# 3. Instalar todas las dependencias del monorepo
pnpm install

# 4. Compilar los módulos WebAssembly (solo la primera vez)
pnpm build:wasm

# 5. Iniciar el servidor de desarrollo
pnpm dev
```

Abre **http://localhost:5173** en Chrome o Edge.

> **Nota:** La exportación de video requiere Chrome/Edge 94+ con WebCodecs habilitado.  
> Los modelos de Whisper se descargan la primera vez que los usas (~39–800 MB según el modelo elegido).

### Build de producción

```bash
pnpm build
# Output en apps/web/dist/
```

### Tests

```bash
# Todos los tests del monorepo
pnpm test

# Solo el core (incluye los 51 tests del detector de muletillas)
pnpm --filter @openreel/core test:run -- --reporter=verbose
```

---

## Estructura del proyecto

```
videoforge/
├── apps/
│   └── web/                          ← Editor (React 18 + Zustand + Vite 5)
│       ├── src/
│       │   ├── components/editor/
│       │   │   ├── inspector/
│       │   │   │   ├── WhisperSubtitlePanel.tsx   ← Auto-subtítulos UI
│       │   │   │   └── FillerDetectorPanel.tsx    ← Detector muletillas UI
│       │   │   ├── SafeAreaOverlay.tsx            ← Overlay SVG plataformas
│       │   │   ├── SocialExportSelector.tsx       ← "Exportar para…" UI
│       │   │   └── ExportDialog.tsx               ← Diálogo export (modificado)
│       │   └── workers/
│       │       └── whisper.worker.ts              ← Web Worker Whisper
│       └── public/
└── packages/
    ├── core/                         ← @openreel/core (sin React)
    │   └── src/
    │       ├── audio/
    │       │   ├── whisper/          ← LocalWhisperEngine
    │       │   └── filler-detector.ts
    │       └── export/
    │           └── social-presets.ts ← Safe areas + specs por plataforma
    └── ui/                           ← @openreel/ui (Radix + shadcn)
```

---

## Features del proyecto base (OpenReel)

- **Timeline multi-track** — video, audio, imagen, texto, gráficos
- **Preview GPU** — WebGPU con fallback Canvas 2D
- **Color grading** — ruedas de color, HSL, curvas RGB, LUTs
- **Efectos de audio** — EQ, compresión, reverb, noise reduction
- **Exportación** — MP4, WebM, MOV, ProRes; hasta 4K con hardware encoding
- **Keyframe animations** — 35+ curvas de easing
- **Karaoke subtitles** — word-level sync
- Ver el [README original](https://github.com/Augani/openreel-video) para la lista completa

---

## Tecnologías

| Stack | Versión |
|---|---|
| React | 18.3.1 |
| TypeScript | 5.4.5 (strict) |
| Vite | 5.3.1 |
| Zustand | 4.5.2 |
| @huggingface/transformers | 3.5.2 |
| WebCodecs API | Chrome 94+ |
| WebGPU API | Chrome 113+ |
| pnpm workspaces | 9.0.0 |

---

## Créditos y Licencia

Este proyecto es un fork de **[OpenReel Video](https://github.com/Augani/openreel-video)**, creado por [Augustus Otu](https://github.com/Augani) y contribuidores.

Las features de IA (Whisper, detector de muletillas) y exportación social fueron desarrolladas por **[devjaime](https://github.com/devjaime)**.

**Licencia: MIT** — ver [LICENSE](LICENSE)

---

## Contacto

**Jaime Hernández**

- 🐙 GitHub: [@devjaime](https://github.com/devjaime)
- 🌐 Blog: [jaimehernandez.dev](https://jaimehernandez.dev)

---

*Built by devjaime · Powered by [OpenReel](https://github.com/Augani/openreel-video)*
