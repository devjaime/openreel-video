/**
 * AutoCaptionPanel
 *
 * Two-tab panel for generating captions / subtitles:
 *
 *   Tab 1 – "Micrófono"  (live Web Speech API transcription)
 *   Tab 2 – "Video IA"   (Whisper ONNX, 100% browser, from a selected clip)
 */

import React, { useState, useCallback, useMemo } from "react";
import { Mic, MicOff, Languages, AlertCircle, Sparkles } from "lucide-react";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { SpeechToTextEngine } from "@openreel/core";
import type {
  TranscriptionProgress,
  TranscriptionSegment,
} from "@openreel/core";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";
import { WhisperSubtitlePanel } from "./WhisperSubtitlePanel";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAPTION_STYLE_PRESETS = [
  {
    id: "default",
    name: "Default",
    description: "White text on dark background",
  },
  { id: "modern", name: "Modern", description: "Clean, minimal style" },
  { id: "bold", name: "Bold", description: "Large, impactful text" },
  { id: "cinematic", name: "Cinematic", description: "Film-style captions" },
  { id: "minimal", name: "Minimal", description: "Subtle, understated" },
];

type TabId = "mic" | "whisper";

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}

function TabButton({ active, onClick, icon, label, badge }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[10px] font-medium transition-colors ${
        active
          ? "bg-primary text-white"
          : "text-text-secondary hover:text-text-primary hover:bg-background-secondary"
      }`}
    >
      {icon}
      {label}
      {badge && (
        <span
          className={`text-[8px] px-1 rounded-full ${
            active ? "bg-white/20 text-white" : "bg-primary/20 text-primary"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Live microphone tab (extracted from original AutoCaptionPanel)
// ---------------------------------------------------------------------------

const LiveMicTab: React.FC = () => {
  const getSpeechToTextEngine = useEngineStore(
    (state) => state.getSpeechToTextEngine,
  );
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const applySubtitleStylePreset = useProjectStore(
    (state) => state.applySubtitleStylePreset,
  );

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("en-US");
  const [selectedStyle, setSelectedStyle] = useState("default");
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isSupported = useMemo(() => SpeechToTextEngine.isSupported(), []);
  const languages = useMemo(
    () => SpeechToTextEngine.getSupportedLanguages(),
    [],
  );

  const handleStartTranscription = useCallback(async () => {
    setError(null);
    setSegments([]);
    setIsTranscribing(true);

    try {
      const speechEngine = await getSpeechToTextEngine();

      speechEngine.setOptions({ language: selectedLanguage });

      speechEngine.onProgress((prog) => {
        setProgress(prog);
      });

      speechEngine.onSegment((segment) => {
        setSegments((prev) => [...prev, segment]);
      });

      await speechEngine.startLiveTranscription();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start transcription",
      );
      setIsTranscribing(false);
    }
  }, [getSpeechToTextEngine, selectedLanguage]);

  const handleStopTranscription = useCallback(async () => {
    const speechEngine = await getSpeechToTextEngine();

    const result = speechEngine.stopTranscription();
    setIsTranscribing(false);
    setProgress(null);

    if (result.success && result.segments.length > 0) {
      const subtitles = speechEngine.segmentsToSubtitles(result.segments);
      subtitles.forEach((subtitle) => {
        addSubtitle(subtitle);
      });

      if (selectedStyle !== "default") {
        await applySubtitleStylePreset(selectedStyle);
      }
    }
  }, [
    getSpeechToTextEngine,
    addSubtitle,
    applySubtitleStylePreset,
    selectedStyle,
  ]);

  const handleApplySegments = useCallback(async () => {
    if (segments.length === 0) return;

    const speechEngine = await getSpeechToTextEngine();

    const subtitles = speechEngine.segmentsToSubtitles(segments);
    subtitles.forEach((subtitle) => {
      addSubtitle(subtitle);
    });

    if (selectedStyle !== "default") {
      await applySubtitleStylePreset(selectedStyle);
    }

    setSegments([]);
  }, [
    getSpeechToTextEngine,
    addSubtitle,
    applySubtitleStylePreset,
    segments,
    selectedStyle,
  ]);

  if (!isSupported) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-status-warning">
          <AlertCircle size={16} />
          <span className="text-[11px] font-medium">Browser Not Supported</span>
        </div>
        <p className="text-[10px] text-text-muted">
          Auto-captions require Chrome or Edge browser with Speech Recognition
          API support.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Languages size={14} className="text-text-secondary" />
            <span className="text-[10px] text-text-secondary">Language</span>
          </div>
          <Select
            value={selectedLanguage}
            onValueChange={setSelectedLanguage}
            disabled={isTranscribing}
          >
            <SelectTrigger className="w-auto min-w-[100px] bg-background-secondary border-border text-text-primary text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">Caption Style</span>
          <Select
            value={selectedStyle}
            onValueChange={setSelectedStyle}
            disabled={isTranscribing}
          >
            <SelectTrigger className="w-auto min-w-[100px] bg-background-secondary border-border text-text-primary text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {CAPTION_STYLE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <span className="text-[10px] text-red-400">{error}</span>
        </div>
      )}

      {isTranscribing && progress && (
        <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">Status</span>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-[10px] text-red-400">Recording</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">
              Segments Found
            </span>
            <span className="text-[10px] text-text-primary font-mono">
              {progress.segmentsFound}
            </span>
          </div>
        </div>
      )}

      {segments.length > 0 && !isTranscribing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">
              {segments.length} caption{segments.length !== 1 ? "s" : ""}{" "}
              detected
            </span>
            <button
              onClick={handleApplySegments}
              className="px-2 py-1 text-[10px] bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Add to Timeline
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {segments.map((segment, index) => (
              <div
                key={index}
                className="p-2 bg-background-secondary rounded text-[10px] text-text-primary"
              >
                <span className="text-text-muted font-mono">
                  [{segment.startTime.toFixed(1)}s -{" "}
                  {segment.endTime.toFixed(1)}s]
                </span>
                <span className="ml-2">{segment.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {!isTranscribing ? (
          <button
            onClick={handleStartTranscription}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
          >
            <Mic size={16} />
            <span className="text-[11px] font-medium">Start Recording</span>
          </button>
        ) : (
          <button
            onClick={handleStopTranscription}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            <MicOff size={16} />
            <span className="text-[11px] font-medium">Stop Recording</span>
          </button>
        )}
      </div>

      <p className="text-[9px] text-text-muted text-center">
        Speak clearly into your microphone. Captions will be generated in
        real-time.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// AutoCaptionPanel — tabbed wrapper
// ---------------------------------------------------------------------------

export const AutoCaptionPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>("whisper");

  return (
    <div className="space-y-3 w-full min-w-0 max-w-full">
      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-background-tertiary rounded-lg">
        <TabButton
          active={activeTab === "whisper"}
          onClick={() => setActiveTab("whisper")}
          icon={<Sparkles size={11} />}
          label="Video IA"
          badge="nuevo"
        />
        <TabButton
          active={activeTab === "mic"}
          onClick={() => setActiveTab("mic")}
          icon={<Mic size={11} />}
          label="Micrófono"
        />
      </div>

      {/* Tab content */}
      {activeTab === "whisper" ? <WhisperSubtitlePanel /> : <LiveMicTab />}
    </div>
  );
};

export default AutoCaptionPanel;
