import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MathMode, AudioSettings, LetterPoint, SynthMode } from './types';
import { parseWordToPoints } from './utils/math';
import { AudioEngine } from './utils/audioEngine';
import { Header } from './components/Header';
import { LetterRibbon } from './components/LetterRibbon';
import { CartesianCanvas } from './components/CartesianCanvas';
import { OscilloscopeCanvas } from './components/OscilloscopeCanvas';
import { MathDisplay } from './components/MathDisplay';
import { TransportBar } from './components/TransportBar';
import { AudioSettingsModal } from './components/AudioSettingsModal';
import { MathGuideModal } from './components/MathGuideModal';
import { ExportAudioModal } from './components/ExportAudioModal';
import { SplashScreen } from './components/SplashScreen';
import { LayoutGrid, LineChart, Waves } from 'lucide-react';

const INITIAL_SETTINGS: AudioSettings = {
  mode: 'melodic',
  bpm: 120,
  pitchShift: 0,
  volume: 0.75,
  filterCutoff: 4500,
  filterResonance: 3.0,
  delayTime: 0.28,
  delayFeedback: 0.45,
  delayMix: 0.35,
  reverbSpace: 'galaxia',
  reverbDecay: 3.5,
  reverbMix: 0.4,
};

type VisualTab = 'cartesian' | 'oscilloscope' | 'split';

export default function App() {
  const [word, setWord] = useState('ALTAIR');
  const [mathMode, setMathMode] = useState<MathMode>('lagrange');
  const [visualTab, setVisualTab] = useState<VisualTab>('split');
  const [generationCount, setGenerationCount] = useState(0);
  const [settings, setSettings] = useState<AudioSettings>(INITIAL_SETTINGS);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [audioProgress, setAudioProgress] = useState(0);

  // Modals state
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState(false);
  const [isMathGuideOpen, setIsMathGuideOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  // Compute letter data points
  const points: LetterPoint[] = useMemo(() => {
    return parseWordToPoints(word);
  }, [word]);

  // Audio Engine instance
  const engineRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    const engine = new AudioEngine(INITIAL_SETTINGS);

    engine.onStepChange = (stepIndex, progress) => {
      setActiveStep(stepIndex);
      setAudioProgress(progress);
    };

    engine.onStateChange = (playing, paused) => {
      setIsPlaying(playing);
      setIsPaused(paused);
      if (!playing) {
        setActiveStep(-1);
        setAudioProgress(0);
      }
    };

    engineRef.current = engine;

    return () => {
      engine.stop();
    };
  }, []);

  const handleGenerate = (newWord: string) => {
    const cleaned = newWord.trim().toUpperCase() || 'ALTAIR';
    setWord(cleaned);
    setGenerationCount((c) => c + 1);
    if (engineRef.current && isPlaying) {
      const newPoints = parseWordToPoints(cleaned);
      engineRef.current.playSequence(newPoints);
    }
  };

  const handlePlay = async () => {
    if (engineRef.current) {
      await engineRef.current.init();
      if (settings.mode === 'melodic') {
        engineRef.current.playSequence(points);
      } else {
        engineRef.current.playTimbralDrone(points);
      }
    }
  };

  const handlePause = () => {
    if (engineRef.current) {
      engineRef.current.pause();
    }
  };

  const handleStop = () => {
    if (engineRef.current) {
      engineRef.current.stop();
    }
  };

  const handleSettingsChange = (newSettings: Partial<AudioSettings>) => {
    const merged = { ...settings, ...newSettings };
    setSettings(merged);
    if (engineRef.current) {
      engineRef.current.updateSettings(newSettings);
      if (newSettings.mode && isPlaying) {
        if (newSettings.mode === 'melodic') {
          engineRef.current.playSequence(points);
        } else {
          engineRef.current.playTimbralDrone(points);
        }
      }
    }
  };

  const handleModeChange = (mode: SynthMode) => {
    handleSettingsChange({ mode });
  };

  const handlePreviewNote = (frequency: number) => {
    if (engineRef.current) {
      engineRef.current.playTone(frequency, 0.4);
    }
  };

  const handleSplashEnter = async () => {
    if (engineRef.current) {
      await engineRef.current.init();
    }
  };

  const analyser = engineRef.current ? engineRef.current.getAnalyser() : null;

  return (
    <div className="min-h-screen bg-[#040510] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.12),rgba(4,5,16,0))] text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* 1. Encabezado y Entrada */}
      <Header
        currentWord={word}
        onGenerate={handleGenerate}
        isPlaying={isPlaying}
        onOpenAudioSettings={() => setIsAudioSettingsOpen(true)}
        onOpenMathGuide={() => setIsMathGuideOpen(true)}
        onOpenExport={() => setIsExportModalOpen(true)}
      />

      {/* Main Content Area: Focused, Clean, Minimalist */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5 md:px-8 space-y-5">
        {/* 2. Mapeo de Datos y Equivalencias Acústicas */}
        <LetterRibbon
          points={points}
          activeStep={activeStep}
          pitchShift={settings.pitchShift}
          onPreviewNote={handlePreviewNote}
        />

        {/* 3. Visualizador Central Dual (Dimensión Cósmica) */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-300 font-mono flex items-center gap-2">
              <LineChart className="w-4 h-4 text-sky-400" />
              <span>Visualizador Dimensional Cósmico</span>
            </h2>

            {/* Selector rápido para alternar entre Gráfica Cartesiana y Osciloscopio */}
            <div className="inline-flex rounded-xl bg-[#090d26]/90 p-1 border border-indigo-500/30 shadow-inner backdrop-blur-md">
              <button
                id="tab-cartesian"
                type="button"
                onClick={() => setVisualTab('cartesian')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg transition-all cursor-pointer ${
                  visualTab === 'cartesian'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.35)] font-semibold'
                    : 'text-indigo-200/80 hover:text-white hover:bg-indigo-950/40'
                }`}
              >
                <LineChart className="w-3.5 h-3.5" />
                <span>Gráfica Cartesiana</span>
              </button>

              <button
                id="tab-oscilloscope"
                type="button"
                onClick={() => setVisualTab('oscilloscope')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg transition-all cursor-pointer ${
                  visualTab === 'oscilloscope'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.35)] font-semibold'
                    : 'text-indigo-200/80 hover:text-white hover:bg-indigo-950/40'
                }`}
              >
                <Waves className="w-3.5 h-3.5" />
                <span>Osciloscopio en Tiempo Real</span>
              </button>

              <button
                id="tab-split"
                type="button"
                onClick={() => setVisualTab('split')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg transition-all cursor-pointer ${
                  visualTab === 'split'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.35)] font-semibold'
                    : 'text-indigo-200/80 hover:text-white hover:bg-indigo-950/40'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Vista Dual</span>
              </button>
            </div>
          </div>

          {/* Canvas Display Area with Subtle Framer Motion Entrance Animations */}
          <AnimatePresence mode="wait">
            {visualTab === 'split' ? (
              <motion.div
                key={`split-${word}-${generationCount}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-4"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="lg:col-span-2"
                >
                  <CartesianCanvas
                    points={points}
                    mode={mathMode}
                    audioProgress={audioProgress}
                    activeStep={activeStep}
                    isPlaying={isPlaying}
                  />
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                  className="h-[260px] sm:h-[320px] lg:h-[380px]"
                >
                  <OscilloscopeCanvas
                    analyser={analyser}
                    isPlaying={isPlaying}
                  />
                </motion.div>
              </motion.div>
            ) : visualTab === 'cartesian' ? (
              <motion.div
                key={`cartesian-${word}-${generationCount}`}
                initial={{ opacity: 0, y: 8, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              >
                <CartesianCanvas
                  points={points}
                  mode={mathMode}
                  audioProgress={audioProgress}
                  activeStep={activeStep}
                  isPlaying={isPlaying}
                />
              </motion.div>
            ) : (
              <motion.div
                key={`oscilloscope-${word}-${generationCount}`}
                initial={{ opacity: 0, y: 8, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="h-[320px] sm:h-[380px]"
              >
                <OscilloscopeCanvas
                  analyser={analyser}
                  isPlaying={isPlaying}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* 4. Barra de Transporte y Reproducción */}
        <TransportBar
          settings={settings}
          isPlaying={isPlaying}
          isPaused={isPaused}
          activeStep={activeStep}
          totalSteps={points.length}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
          onModeChange={handleModeChange}
          onOpenSettings={() => setIsAudioSettingsOpen(true)}
        />

        {/* 5. Sección de Fórmula Matemática Continua (Ubicada en la parte inferior) */}
        <section id="math-formula-section" className="pt-2">
          <MathDisplay
            points={points}
            mode={mathMode}
            onModeChange={setMathMode}
          />
        </section>
      </main>

      {/* Subtle Minimal Footer */}
      <footer className="border-t border-indigo-500/10 py-4 px-4 text-center text-xs font-mono text-slate-500">
        AstroFirma Sonora &bull; Web Audio API DSP &bull; Polinomios de Lagrange &bull; Transformada de Fourier
      </footer>

      {/* MODAL 1: Ajustes de Audio y Efectos */}
      <AudioSettingsModal
        isOpen={isAudioSettingsOpen}
        onClose={() => setIsAudioSettingsOpen(false)}
        settings={settings}
        isPlaying={isPlaying}
        onSettingsChange={handleSettingsChange}
      />

      {/* MODAL 2: Explicación Matemática y Acústica */}
      <MathGuideModal
        isOpen={isMathGuideOpen}
        onClose={() => setIsMathGuideOpen(false)}
      />

      {/* MODAL 3: Exportación de Firma de Audio (WAV) */}
      <ExportAudioModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        word={word}
        points={points}
        settings={settings}
      />

      {/* Pantalla de Bienvenida (Splash Screen) con desbloqueo de AudioContext */}
      {showSplash && (
        <SplashScreen onEnter={handleSplashEnter} />
      )}
    </div>
  );
}
