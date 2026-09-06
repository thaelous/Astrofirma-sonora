import React from 'react';
import { LetterPoint } from '../types';
import { Music, Hash, Volume2 } from 'lucide-react';

interface LetterRibbonProps {
  points: LetterPoint[];
  activeStep: number;
  pitchShift: number;
  onPreviewNote: (frequency: number) => void;
}

export const LetterRibbon: React.FC<LetterRibbonProps> = ({
  points,
  activeStep,
  pitchShift,
  onPreviewNote,
}) => {
  return (
    <div className="w-full bg-[#06091f]/85 border border-indigo-500/20 rounded-2xl p-4.5 backdrop-blur-md shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-200 font-mono">
            Mapeo de Datos & Equivalencias Acústicas
          </h2>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          Fórmula:&nbsp;
          <span className="text-sky-300 font-medium">f = 440 &times; 2^((MIDI - 69) / 12)</span>
        </div>
      </div>

      {/* Horizontal ribbon / tape */}
      <div className="overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-indigo-500/30 scrollbar-track-transparent">
        <div className="flex items-stretch gap-2.5 min-w-max">
          {points.map((p) => {
            const isActive = activeStep === p.index;
            const shiftedMidi = p.midiNote + pitchShift;
            const currentFreq = 440 * Math.pow(2, (shiftedMidi - 69) / 12);

            return (
              <div
                key={`${p.index}-${p.char}`}
                id={`letter-card-${p.index}`}
                onClick={() => onPreviewNote(currentFreq)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onPreviewNote(currentFreq);
                  }
                }}
                className={`group relative flex flex-col items-center justify-between p-3 rounded-xl border transition-all cursor-pointer min-w-[84px] select-none ${
                  isActive
                    ? 'bg-gradient-to-b from-indigo-600/40 to-sky-600/30 border-cyan-400 shadow-[0_0_20px_rgba(56,189,248,0.45)] scale-105 z-10'
                    : 'bg-[#090e29]/80 border-indigo-500/20 hover:border-indigo-400/60 hover:bg-[#0c133a]/80'
                }`}
              >
                {/* Active glow pip */}
                {isActive && (
                  <span className="absolute -top-1.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-400"></span>
                  </span>
                )}

                {/* Top: Position X */}
                <span className="text-[10px] font-mono text-indigo-300/70">
                  x = {p.index}
                </span>

                {/* Big Character */}
                <div className="my-1 text-2xl font-bold font-mono tracking-wider text-white group-hover:text-cyan-300 transition-colors">
                  {p.char}
                </div>

                {/* ASCII Code (Y) */}
                <div className="text-[11px] font-mono text-indigo-200 bg-[#0c1236] px-2 py-0.5 rounded border border-indigo-500/30 mb-1.5 shadow-inner">
                  y = {p.ascii}
                </div>

                {/* Musical Note & Hz */}
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <div className="flex items-center gap-1 text-xs font-semibold font-mono text-sky-300">
                    <Music className="w-3 h-3 text-sky-400" />
                    <span>{p.noteName}</span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    {currentFreq.toFixed(1)} Hz
                  </div>
                </div>

                {/* Audio preview icon on hover */}
                <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-cyan-400">
                  <Volume2 className="w-3.5 h-3.5" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
