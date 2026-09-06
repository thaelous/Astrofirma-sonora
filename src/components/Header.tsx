import React, { useState } from 'react';
import { Sparkles, Sliders, BookOpen, Download, Radio } from 'lucide-react';

interface HeaderProps {
  currentWord: string;
  onGenerate: (word: string) => void;
  isPlaying: boolean;
  onOpenAudioSettings: () => void;
  onOpenMathGuide: () => void;
  onOpenExport?: () => void;
}

const PRESETS = ['ALTAIR', 'ALDEBARÁN', 'COSMOS', 'AURORA', 'ORION', 'QUANTUM', 'NEBULA'];

export const Header: React.FC<HeaderProps> = ({
  currentWord,
  onGenerate,
  isPlaying,
  onOpenAudioSettings,
  onOpenMathGuide,
  onOpenExport,
}) => {
  const [inputVal, setInputVal] = useState(currentWord);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim()) {
      onGenerate(inputVal.trim().toUpperCase());
    }
  };

  const handlePreset = (preset: string) => {
    setInputVal(preset);
    onGenerate(preset);
  };

  return (
    <header className="relative border-b border-indigo-500/20 bg-[#050718]/90 backdrop-blur-xl px-4 py-5 md:px-8 shadow-xl">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Top subtle bar: Title + Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/30 to-sky-500/20 border border-indigo-400/30 flex items-center justify-center text-cyan-300 shadow-inner">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold font-['Cinzel',serif] tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-sky-200 to-indigo-300">
                  AstroFirma Sonora
                </h1>
                {isPlaying && (
                  <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-400/40 text-cyan-300">
                    <Radio className="w-2.5 h-2.5 animate-ping text-cyan-400" />
                    EN VIVO
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Fórmula cartesiana &bull; Gráfica continua &bull; Síntesis espacial Web Audio
              </p>
            </div>
          </div>

          {/* Quick Access Modal Buttons */}
          <div className="flex items-center gap-2">
            <button
              id="header-audio-settings-btn"
              type="button"
              onClick={onOpenAudioSettings}
              className="h-10 px-3.5 rounded-xl bg-[#090e2e] hover:bg-indigo-950/50 border border-indigo-500/30 hover:border-cyan-400 text-xs font-mono text-cyan-300 hover:text-white flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
              title="Abrir Ajustes de Audio y Efectos"
            >
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Ajustes de Audio</span>
            </button>

            <button
              id="header-math-guide-btn"
              type="button"
              onClick={onOpenMathGuide}
              className="h-10 px-3.5 rounded-xl bg-[#090e2e] hover:bg-indigo-950/50 border border-indigo-500/30 hover:border-indigo-400 text-xs font-mono text-indigo-200 hover:text-white flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
              title="Abrir Explicación Matemática y Acústica"
            >
              <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
              <span>Explicación Matemática</span>
            </button>

            {onOpenExport && (
              <button
                id="header-export-wav-btn"
                type="button"
                onClick={onOpenExport}
                className="h-10 px-3.5 rounded-xl bg-[#090e2e] hover:bg-cyan-950/50 border border-cyan-500/30 hover:border-cyan-400 text-xs font-mono text-slate-200 hover:text-white flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
                title="Exportar archivo de audio WAV"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Exportar WAV</span>
              </button>
            )}
          </div>
        </div>

        {/* Word Input & Action */}
        <div className="space-y-2.5">
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-stretch">
            <div className="relative flex-1">
              <input
                id="word-input"
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                maxLength={24}
                placeholder="Ingresa un nombre o palabra (ej. ALTAIR, ALDEBARÁN)..."
                className="w-full h-11 rounded-xl bg-[#090e2e]/90 border border-indigo-500/35 px-4 text-base font-mono tracking-widest text-white placeholder-slate-400/40 shadow-inner focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 transition-all uppercase"
              />
              <span className="absolute right-3.5 top-3 text-[11px] font-mono text-indigo-300/60 uppercase pointer-events-none">
                {inputVal.length} caracteres
              </span>
            </div>

            <button
              id="generate-button"
              type="submit"
              className="h-11 px-6 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-sky-500 text-white font-semibold font-['Plus_Jakarta_Sans',sans-serif] text-sm tracking-wide shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Generar Firma</span>
            </button>
          </form>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="text-[11px] font-mono text-slate-400 mr-1">Pruebas rápidas:</span>
            {PRESETS.map((preset) => {
              const isSelected = currentWord.toUpperCase() === preset;
              return (
                <button
                  key={preset}
                  id={`preset-${preset.toLowerCase()}`}
                  onClick={() => handlePreset(preset)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-lg transition-all border cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/40 border-cyan-400 text-white shadow-[0_0_10px_rgba(56,189,248,0.3)] font-semibold'
                      : 'bg-[#090e29]/70 border-indigo-500/20 text-slate-300 hover:border-indigo-400/50 hover:text-white'
                  }`}
                >
                  {preset}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
};
