import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  MicOff,
  RotateCcw,
  Volume2,
  Activity,
  Sliders,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Info,
  Copy,
  Check,
  Music,
  LineChart,
  Radio,
  Terminal,
} from 'lucide-react';
import { parseWordToPoints, midiToNoteName } from '../utils/math';
import { CartesianCanvas } from './CartesianCanvas';
import { LetterPoint } from '../types';

interface DecodedLetter {
  id: string;
  char: string;
  ascii: number;
  midi: number;
  frequency: number;
  noteName: string;
  centsOff: number;
  timestamp: number;
}

interface AcousticDecoderProps {
  onSendToEmitter: (word: string) => void;
}

export const AcousticDecoder: React.FC<AcousticDecoderProps> = ({ onSendToEmitter }) => {
  // Listening state
  const [isListening, setIsListening] = useState<boolean>(false);
  const [hasPermissionError, setHasPermissionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Listo para escuchar. Presiona "Comenzar a Escuchar" para activar el micrófono.'
  );
  const [statusPhase, setStatusPhase] = useState<'idle' | 'waiting' | 'detecting' | 'completed'>(
    'idle'
  );

  // Decoded sequence
  const [decodedLetters, setDecodedLetters] = useState<DecodedLetter[]>([]);
  const [isSequenceCompleted, setIsSequenceCompleted] = useState<boolean>(false);
  const [completedWord, setCompletedWord] = useState<string>('');
  const [completedPoints, setCompletedPoints] = useState<LetterPoint[]>([]);
  const [copied, setCopied] = useState<boolean>(false);

  // Live audio metrics
  const [liveFreq, setLiveFreq] = useState<number | null>(null);
  const [liveNoteName, setLiveNoteName] = useState<string>('---');
  const [liveMidi, setLiveMidi] = useState<number | null>(null);
  const [liveRms, setLiveRms] = useState<number>(0);
  const [liveConfidence, setLiveConfidence] = useState<number>(0);
  const [rawDebugText, setRawDebugText] = useState<string>('Micrófono en espera');

  // Decoder adjustable parameters
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [noiseThreshold, setNoiseThreshold] = useState<number>(0.015); // RMS threshold (default 0.015 as specified)
  const [minConfidence, setMinConfidence] = useState<number>(0.88); // Min confidence (default 0.88, range >= 0.85)
  const [minStableFrames, setMinStableFrames] = useState<number>(4); // Require 3-4 consecutive frames (default 4)
  const [tuningToleranceCents, setTuningToleranceCents] = useState<number>(45); // +/- cents
  const [silenceTimeoutSec, setSilenceTimeoutSec] = useState<number>(2.2); // sec of silence to complete

  // Refs for Web Audio API
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Tracking state refs for autocorrelation & debounce inside the audio loop
  const trackingRef = useRef<{
    candidateMidi: number | null;
    candidateCount: number;
    candidateFreq: number;
    candidateCentsOff: number;
    lastRegisteredMidi: number | null;
    hasDroppedBelowRmsSinceLastNote: boolean;
    silenceStartTime: number | null;
    hasLettersSinceStart: boolean;
  }>({
    candidateMidi: null,
    candidateCount: 0,
    candidateFreq: 0,
    candidateCentsOff: 0,
    lastRegisteredMidi: null,
    hasDroppedBelowRmsSinceLastNote: true,
    silenceStartTime: null,
    hasLettersSinceStart: false,
  });

  // Keep settings synced in refs to avoid restarting audio loop on slider drag
  const settingsRef = useRef({
    noiseThreshold,
    minConfidence,
    minStableFrames,
    tuningToleranceCents,
    silenceTimeoutSec,
  });

  useEffect(() => {
    settingsRef.current = {
      noiseThreshold,
      minConfidence,
      minStableFrames,
      tuningToleranceCents,
      silenceTimeoutSec,
    };
  }, [noiseThreshold, minConfidence, minStableFrames, tuningToleranceCents, silenceTimeoutSec]);

  // Robust Pitch Detection Algorithm: Normalized Square Difference Function (NSDF / YIN time-domain autocorrelation)
  const detectPitch = (
    buffer: Float32Array,
    sampleRate: number,
    thresholdRms: number,
    confidenceThreshold: number
  ): {
    freq: number | null;
    rms: number;
    confidence: number;
    rawMidi: number | null;
    rawNote: string;
  } => {
    const bufferLength = buffer.length;

    // 1. Calculate RMS of the time domain buffer
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i++) {
      const val = buffer[i];
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / bufferLength);

    // If RMS is below threshold (0.015 default), abort cycle and do not detect pitch
    if (rms < thresholdRms) {
      return { freq: null, rms, confidence: 0, rawMidi: null, rawNote: '---' };
    }

    // 2. Bound lag search strictly between 150 Hz and 2200 Hz
    const minLag = Math.floor(sampleRate / 2200);
    const maxLag = Math.ceil(sampleRate / 150);

    if (maxLag >= bufferLength - 2) {
      return { freq: null, rms, confidence: 0, rawMidi: null, rawNote: '---' };
    }

    // 3. Normalized Square Difference Function (NSDF)
    // Window length W ensures we stay within buffer boundaries
    const W = bufferLength - maxLag;

    // m0 = sum_{j=0}^{W-1} buffer[j]^2
    let m0 = 0;
    for (let j = 0; j < W; j++) {
      m0 += buffer[j] * buffer[j];
    }

    if (m0 < 0.00001) {
      return { freq: null, rms, confidence: 0, rawMidi: null, rawNote: '---' };
    }

    // Precalculate term2: sum_{j=0}^{W-1} buffer[j + tau]^2 using sliding sum
    const term2 = new Float32Array(maxLag + 2);
    term2[0] = m0;
    for (let tau = 1; tau <= maxLag + 1; tau++) {
      term2[tau] =
        term2[tau - 1] -
        buffer[tau - 1] * buffer[tau - 1] +
        buffer[tau - 1 + W] * buffer[tau - 1 + W];
    }

    // Calculate NSDF normalized correlation values
    const nsdf = new Float32Array(maxLag + 2);
    for (let tau = minLag - 1; tau <= maxLag + 1; tau++) {
      let r = 0;
      for (let j = 0; j < W; j++) {
        r += buffer[j] * buffer[j + tau];
      }
      const m = m0 + term2[tau];
      nsdf[tau] = m > 0.00001 ? (2 * r) / m : 0;
    }

    // 4. Find all local maxima (peaks) within [minLag, maxLag]
    interface Peak {
      lag: number;
      val: number;
    }
    const peaks: Peak[] = [];
    let maxPeakVal = -1;

    for (let tau = minLag; tau <= maxLag; tau++) {
      const val = nsdf[tau];
      if (val > nsdf[tau - 1] && val >= nsdf[tau + 1] && val > 0) {
        peaks.push({ lag: tau, val });
        if (val > maxPeakVal) {
          maxPeakVal = val;
        }
      }
    }

    // Reject if no valid peaks or if global max peak is below required confidence threshold
    if (peaks.length === 0 || maxPeakVal < confidenceThreshold) {
      return { freq: null, rms, confidence: Math.max(0, maxPeakVal), rawMidi: null, rawNote: '---' };
    }

    // 5. Pick the first significant peak >= (0.85 * maxPeakVal) to prevent octave errors
    const cutoff = Math.max(confidenceThreshold, maxPeakVal * 0.85);
    let bestPeak = peaks[0];
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i].val >= cutoff) {
        bestPeak = peaks[i];
        break;
      }
    }

    // 6. Sub-sample Parabolic Interpolation for accurate pitch
    const bestLag = bestPeak.lag;
    const y1 = nsdf[bestLag - 1];
    const y2 = nsdf[bestLag];
    const y3 = nsdf[bestLag + 1];

    const denom = 2 * (2 * y2 - y1 - y3);
    let delta = 0;
    if (Math.abs(denom) > 1e-6) {
      delta = (y3 - y1) / denom;
    }
    // Clamp delta to safe interval
    delta = Math.max(-0.5, Math.min(0.5, delta));
    const refinedLag = bestLag + delta;
    const fundamentalFreq = sampleRate / refinedLag;

    // Strict frequency boundary check between 150 Hz and 2200 Hz
    if (fundamentalFreq < 150 || fundamentalFreq > 2200) {
      return { freq: null, rms, confidence: bestPeak.val, rawMidi: null, rawNote: '---' };
    }

    const exactMidi = 69 + 12 * Math.log2(fundamentalFreq / 440);
    const roundedMidi = Math.round(exactMidi);
    const rawNote = midiToNoteName(roundedMidi);

    return {
      freq: fundamentalFreq,
      rms,
      confidence: bestPeak.val,
      rawMidi: roundedMidi,
      rawNote,
    };
  };

  // Stop microphone and clean up audio context
  const stopListening = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setIsListening(false);
    setLiveFreq(null);
    setLiveNoteName('---');
    setLiveMidi(null);
    setLiveRms(0);
    setLiveConfidence(0);
    setRawDebugText('Micrófono detenido');
    setStatusPhase('idle');
    setStatusMessage('Escucha detenida. Micrófono desactivado.');
  }, []);

  // Register a new identified letter into state
  const handleRegisterLetter = useCallback(
    (midi: number, freq: number, centsOff: number) => {
      // Validate character within standard printable ASCII range
      const ascii = midi;
      if (ascii < 32 || ascii > 126) {
        return;
      }
      const char = String.fromCharCode(ascii);
      const noteName = midiToNoteName(midi);

      const newLetter: DecodedLetter = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        char,
        ascii,
        midi,
        frequency: freq,
        noteName,
        centsOff,
        timestamp: Date.now(),
      };

      setDecodedLetters((prev) => {
        const updated = [...prev, newLetter];
        const constructed = updated.map((l) => l.char).join('');
        setCompletedWord(constructed);
        setCompletedPoints(parseWordToPoints(constructed));
        return updated;
      });

      setStatusPhase('detecting');
      setStatusMessage(`Nota detectada: ${noteName} ('${char}') a ${freq.toFixed(1)} Hz`);
    },
    []
  );

  // Audio Processing Loop
  const startAudioLoop = useCallback(
    (analyser: AnalyserNode, sampleRate: number) => {
      const bufferLength = analyser.fftSize; // 2048
      const timeDomainBuffer = new Float32Array(bufferLength);
      const canvas = canvasRef.current;
      const ctx = canvas ? canvas.getContext('2d') : null;

      let frameCounter = 0;

      const loop = () => {
        frameCounter++;
        analyser.getFloatTimeDomainData(timeDomainBuffer);

        const {
          noiseThreshold,
          minConfidence,
          minStableFrames,
          tuningToleranceCents,
          silenceTimeoutSec,
        } = settingsRef.current;

        // Run robust YIN / NSDF time-domain pitch detection
        const { freq, rms, confidence, rawMidi, rawNote } = detectPitch(
          timeDomainBuffer,
          sampleRate,
          noiseThreshold,
          minConfidence
        );

        const now = performance.now();
        const tracking = trackingRef.current;

        // Update live RMS for visual feedback on every frame
        setLiveRms(rms);

        if (freq && freq >= 150 && freq <= 2200) {
          // Tone is present: reset silence timer
          tracking.silenceStartTime = null;

          // Inverse MIDI Calculation: MIDI = round(69 + 12 * log2(f / 440))
          const exactMidi = 69 + 12 * Math.log2(freq / 440);
          const roundedMidi = Math.round(exactMidi);
          const centsOff = (exactMidi - roundedMidi) * 100;

          // Check tuning tolerance and ASCII printable range
          if (
            Math.abs(centsOff) <= tuningToleranceCents &&
            roundedMidi >= 32 &&
            roundedMidi <= 126
          ) {
            // Update live metrics
            setLiveFreq(freq);
            setLiveMidi(roundedMidi);
            setLiveNoteName(rawNote || midiToNoteName(roundedMidi));
            setLiveConfidence(confidence);

            const char = String.fromCharCode(roundedMidi);
            setRawDebugText(
              `Detectando: ${freq.toFixed(1)} Hz -> MIDI: ${roundedMidi} -> '${char}' (${rawNote}) [Conf: ${(confidence * 100).toFixed(0)}%]`
            );

            // Stability check: candidate counting across consecutive frames
            if (tracking.candidateMidi === roundedMidi) {
              tracking.candidateCount++;
            } else {
              tracking.candidateMidi = roundedMidi;
              tracking.candidateCount = 1;
              tracking.candidateFreq = freq;
              tracking.candidateCentsOff = centsOff;
            }

            // Require 3 to 4 consecutive stable frames (~60-100 ms)
            if (tracking.candidateCount >= minStableFrames) {
              const isSameAsLast = tracking.lastRegisteredMidi === roundedMidi;

              // If next note is identical to the previous, require RMS to have dropped below threshold first
              if (!isSameAsLast || tracking.hasDroppedBelowRmsSinceLastNote) {
                tracking.lastRegisteredMidi = roundedMidi;
                tracking.hasDroppedBelowRmsSinceLastNote = false;
                tracking.hasLettersSinceStart = true;
                tracking.silenceStartTime = null;
                // Prevent continuous re-registration while the tone stays on
                tracking.candidateCount = -9999;

                handleRegisterLetter(roundedMidi, freq, centsOff);
                console.log(
                  `[AcousticDecoder] ✅ Nota registrada: ${freq.toFixed(1)} Hz -> MIDI ${roundedMidi} ('${char}')`
                );
              }
            }
          } else {
            // Pitch found but out of tuning tolerance or non-ASCII
            setRawDebugText(
              `Tono detectado: ${freq.toFixed(1)} Hz (Desafinación ${centsOff.toFixed(0)}c > ±${tuningToleranceCents}c)`
            );
          }
        } else {
          // Silence or below RMS threshold or no periodic pitch
          tracking.candidateMidi = null;
          tracking.candidateCount = 0;

          // If RMS drops below noise threshold, register that silence occurred between notes
          if (rms < noiseThreshold) {
            tracking.hasDroppedBelowRmsSinceLastNote = true;
          }

          // Clear active note display periodically when silent
          if (frameCounter % 6 === 0) {
            setLiveFreq(null);
            setLiveNoteName('---');
            setLiveMidi(null);
            setLiveConfidence(0);
          }

          // Real-time raw debug text
          if (rms >= noiseThreshold) {
            setRawDebugText(
              `Señal activa (RMS: ${(rms * 100).toFixed(1)}%) -> Sin periodicidad (Conf: ${(confidence * 100).toFixed(0)}% < ${(minConfidence * 100).toFixed(0)}%)`
            );
          } else {
            setRawDebugText(
              `En silencio (RMS: ${(rms * 100).toFixed(1)}% < ${(noiseThreshold * 100).toFixed(1)}% umbral)`
            );
          }

          // Silence timeout check to finish sequence
          if (tracking.hasLettersSinceStart) {
            if (tracking.silenceStartTime === null) {
              tracking.silenceStartTime = now;
            } else {
              const silenceElapsed = (now - tracking.silenceStartTime) / 1000;
              if (silenceElapsed >= silenceTimeoutSec) {
                tracking.hasLettersSinceStart = false;
                tracking.silenceStartTime = null;
                setIsSequenceCompleted(true);
                setStatusPhase('completed');
                setStatusMessage('¡Secuencia completada! Palabra reconstruida y graficada.');
              } else if (silenceElapsed > 0.5) {
                setStatusPhase('waiting');
                setStatusMessage(
                  `Esperando siguiente nota... (${(silenceTimeoutSec - silenceElapsed).toFixed(
                    1
                  )}s para finalizar)`
                );
              }
            }
          }
        }

        // Draw Live Canvas Oscilloscope Visualizer
        if (canvas && ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Subtle dark background
          ctx.fillStyle = '#040615';
          ctx.fillRect(0, 0, w, h);

          // Center horizon line
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();

          // Waveform
          const sliceWidth = w / bufferLength;
          let x = 0;

          const isSignal = rms >= noiseThreshold;
          const gradient = ctx.createLinearGradient(0, 0, w, 0);
          if (freq !== null && isSignal) {
            gradient.addColorStop(0, '#06b6d4');
            gradient.addColorStop(0.5, '#38bdf8');
            gradient.addColorStop(1, '#818cf8');
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 8;
          } else if (isSignal) {
            gradient.addColorStop(0, '#34d399');
            gradient.addColorStop(1, '#06b6d4');
            ctx.shadowBlur = 4;
          } else {
            gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
            gradient.addColorStop(1, 'rgba(148, 163, 184, 0.35)');
            ctx.shadowBlur = 0;
          }

          ctx.lineWidth = isSignal ? 2.2 : 1.2;
          ctx.strokeStyle = gradient;
          ctx.beginPath();

          for (let i = 0; i < bufferLength; i += 2) {
            const v = timeDomainBuffer[i];
            const y = (0.5 - v * 1.5) * h;

            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
            x += sliceWidth * 2;
          }
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Noise gate threshold line
          const threshY = (0.5 - noiseThreshold * 3) * h;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(0, threshY);
          ctx.lineTo(w, threshY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        animFrameIdRef.current = requestAnimationFrame(loop);
      };

      loop();
    },
    [handleRegisterLetter]
  );

  // Start microphone listening
  const startListening = async () => {
    setHasPermissionError(null);
    setIsSequenceCompleted(false);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Tu navegador no soporta captura de micrófono mediante getUserMedia.');
      }

      // Explicitly disable echo cancellation, noise suppression, and auto gain control
      // to avoid filtering out pure synthesizer frequencies
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      mediaStreamRef.current = stream;

      // Initialize AudioContext
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      // Explicitly resume AudioContext within user click interaction
      if (audioCtx.state !== 'running') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048; // Buffer size of 2048 as specified
      analyser.smoothingTimeConstant = 0; // Pure instantaneous time domain
      analyserRef.current = analyser;

      source.connect(analyser);

      console.log(
        `[AcousticDecoder] AudioContext iniciado (estado: ${audioCtx.state}, sampleRate: ${audioCtx.sampleRate} Hz)`
      );

      // Reset tracking state
      trackingRef.current = {
        candidateMidi: null,
        candidateCount: 0,
        candidateFreq: 0,
        candidateCentsOff: 0,
        lastRegisteredMidi: null,
        hasDroppedBelowRmsSinceLastNote: true,
        silenceStartTime: null,
        hasLettersSinceStart: false,
      };

      setIsListening(true);
      setStatusPhase('waiting');
      setStatusMessage('Micrófono activo y calibrado. Reproduce la firma sonora cerca.');
      setRawDebugText('Micrófono conectado. Esperando tonos...');

      // Start detection loop driven by requestAnimationFrame
      startAudioLoop(analyser, audioCtx.sampleRate);
    } catch (err: unknown) {
      console.error('Error al acceder al micrófono:', err);
      const errMsg =
        err instanceof Error
          ? err.message
          : 'No se pudo acceder al micrófono. Verifica los permisos de audio en tu navegador.';
      setHasPermissionError(errMsg);
      setStatusPhase('idle');
      setStatusMessage('Error de acceso al micrófono. Por favor concede permisos.');
      stopListening();
    }
  };

  // Reset and clear sequence
  const handleReset = () => {
    setDecodedLetters([]);
    setCompletedWord('');
    setCompletedPoints([]);
    setIsSequenceCompleted(false);
    trackingRef.current = {
      candidateMidi: null,
      candidateCount: 0,
      candidateFreq: 0,
      candidateCentsOff: 0,
      lastRegisteredMidi: null,
      hasDroppedBelowRmsSinceLastNote: true,
      silenceStartTime: null,
      hasLettersSinceStart: false,
    };
    if (isListening) {
      setStatusPhase('waiting');
      setStatusMessage('Secuencia reiniciada. Esperando notas acústicas...');
      setRawDebugText('Receptor reiniciado. Esperando tonos...');
    } else {
      setStatusPhase('idle');
      setStatusMessage('Listo para escuchar. Presiona "Comenzar a Escuchar".');
      setRawDebugText('Micrófono en espera');
    }
  };

  // Copy reconstructed word
  const handleCopyWord = () => {
    if (completedWord) {
      navigator.clipboard.writeText(completedWord);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return (
    <div className="w-full space-y-6">
      {/* 1. Header Banner & Instructions */}
      <div className="bg-[#06091f]/90 border border-indigo-500/25 rounded-2xl p-5 md:p-6 shadow-xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-400/30 text-cyan-300 text-xs font-mono">
              <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span>Decodificador Acústico Inverso en Tiempo Real</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold font-['Cinzel',serif] text-white tracking-wide">
              Receptor de Firma Sonora (Micrófono)
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 font-sans leading-relaxed">
              Escucha las notas acústicas transmitidas por el altavoz de otro dispositivo (teléfono o
              computadora) a través del aire. El algoritmo de autocorrelación calcula los Hertz de cada tono,
              obtiene el número MIDI mediante la fórmula inversa y reconstruye el nombre letra por letra sin
              servidores ni latencia externa.
            </p>
          </div>

          {/* Action Buttons: Listen & Reset & Settings */}
          <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3 w-full lg:w-auto">
            {!isListening ? (
              <button
                id="btn-start-listening"
                type="button"
                onClick={startListening}
                className="w-full sm:w-auto justify-center px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-mono text-xs sm:text-sm font-semibold flex items-center gap-2.5 shadow-[0_0_20px_rgba(6,182,212,0.45)] hover:shadow-[0_0_28px_rgba(6,182,212,0.65)] transition-all cursor-pointer active:scale-95"
              >
                <Mic className="w-4 h-4 text-cyan-100 shrink-0" />
                <span>Comenzar a Escuchar</span>
              </button>
            ) : (
              <button
                id="btn-stop-listening"
                type="button"
                onClick={stopListening}
                className="w-full sm:w-auto justify-center px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-rose-600/90 hover:bg-rose-500 border border-rose-400/40 text-white font-mono text-xs sm:text-sm font-semibold flex items-center gap-2.5 shadow-[0_0_20px_rgba(244,63,94,0.45)] transition-all cursor-pointer active:scale-95 animate-pulse"
              >
                <MicOff className="w-4 h-4 shrink-0" />
                <span>Detener Micrófono</span>
              </button>
            )}

            <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
              <button
                id="btn-reset-decoder"
                type="button"
                onClick={handleReset}
                className="w-full sm:w-auto justify-center px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-[#090d28] hover:bg-indigo-950/60 border border-indigo-500/30 text-indigo-200 hover:text-white font-mono text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-95"
                title="Reiniciar y borrar secuencia"
              >
                <RotateCcw className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Limpiar</span>
              </button>

              <button
                id="btn-toggle-decoder-settings"
                type="button"
                onClick={() => setShowSettings((s) => !s)}
                className={`w-full sm:w-auto justify-center px-3 sm:px-3.5 py-2.5 sm:py-3 rounded-xl border font-mono text-xs flex items-center gap-2 transition-all cursor-pointer ${
                  showSettings
                    ? 'bg-indigo-600/40 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(56,189,248,0.3)]'
                    : 'bg-[#090d28] border-indigo-500/30 text-slate-300 hover:text-white hover:bg-indigo-950/50'
                }`}
                title="Ajustes de Sensibilidad y Tolerancia de Afinación"
              >
                <Sliders className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Ajustes</span>
              </button>
            </div>
          </div>
        </div>

        {/* Error Notice if permissions rejected */}
        {hasPermissionError && (
          <div className="mt-4 p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs font-mono flex items-start gap-2.5">
            <Info className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Permiso de micrófono requerido: </span>
              <span>{hasPermissionError}</span>
            </div>
          </div>
        )}
      </div>

      {/* 2. Adjustable Settings Panel (Collapsible) */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="bg-[#070b24] border border-cyan-500/30 rounded-2xl p-3.5 sm:p-5 shadow-lg space-y-3 sm:space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-indigo-500/20 pb-2">
                <div className="flex items-center gap-2 text-cyan-300 font-mono text-xs font-semibold uppercase tracking-wider">
                  <Sliders className="w-4 h-4 shrink-0" />
                  <span>Calibración de Entrada y Tolerancia Acústica</span>
                </div>
                <span className="text-[10px] sm:text-[11px] font-mono text-slate-400">
                  Optimiza para altavoces o ruido ambiental
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
                {/* 1. Sensibilidad del Micrófono (Umbral RMS) */}
                <div className="space-y-1.5 bg-[#0a0f30]/80 p-3 rounded-xl border border-indigo-500/20">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-300">Umbral Silencio (RMS):</span>
                    <span className="text-cyan-400 font-bold">{(noiseThreshold * 100).toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.005"
                    max="0.05"
                    step="0.001"
                    value={noiseThreshold}
                    onChange={(e) => setNoiseThreshold(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>0.5% (Silencioso)</span>
                    <span>5.0% (Ruidoso)</span>
                  </div>
                </div>

                {/* 2. Confiabilidad YIN / Autocorrelación */}
                <div className="space-y-1.5 bg-[#0a0f30]/80 p-3 rounded-xl border border-indigo-500/20">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-300">Filtro Confiabilidad:</span>
                    <span className="text-cyan-400 font-bold">{(minConfidence * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.75"
                    max="0.95"
                    step="0.01"
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>75% (Flexible)</span>
                    <span>95% (Estricto)</span>
                  </div>
                </div>

                {/* 3. Estabilidad de Nota (Cuadros consecutivos) */}
                <div className="space-y-1.5 bg-[#0a0f30]/80 p-3 rounded-xl border border-indigo-500/20">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-300">Estabilidad Nota:</span>
                    <span className="text-cyan-400 font-bold">{minStableFrames} cuadros</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="6"
                    step="1"
                    value={minStableFrames}
                    onChange={(e) => setMinStableFrames(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>2 (~33ms)</span>
                    <span>6 (~100ms)</span>
                  </div>
                </div>

                {/* 4. Tolerancia de Afinación (cents) */}
                <div className="space-y-1.5 bg-[#0a0f30]/80 p-3 rounded-xl border border-indigo-500/20">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-300">Tolerancia Afinación:</span>
                    <span className="text-cyan-400 font-bold">&plusmn;{tuningToleranceCents}c</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="50"
                    step="1"
                    value={tuningToleranceCents}
                    onChange={(e) => setTuningToleranceCents(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>&plusmn;20c (Preciso)</span>
                    <span>&plusmn;50c (Amplio)</span>
                  </div>
                </div>

                {/* 5. Tiempo Fin de Secuencia (silence timeout) */}
                <div className="space-y-1.5 bg-[#0a0f30]/80 p-3 rounded-xl border border-indigo-500/20 sm:col-span-2 lg:col-span-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-300">Fin Secuencia:</span>
                    <span className="text-cyan-400 font-bold">{silenceTimeoutSec.toFixed(1)} s</span>
                  </div>
                  <input
                    type="range"
                    min="1.4"
                    max="4.0"
                    step="0.2"
                    value={silenceTimeoutSec}
                    onChange={(e) => setSilenceTimeoutSec(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>1.4 s</span>
                    <span>4.0 s</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Visualizador de Entrada Espectral & Métricas en Vivo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* Live Audio Oscilloscope Canvas */}
        <div className="lg:col-span-2 bg-[#06091f]/90 border border-indigo-500/20 rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between backdrop-blur-md shadow-xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-200">
              <Activity className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
              <span className="font-semibold uppercase tracking-wider truncate">
                Monitor Osciloscopio (Dominio del Tiempo 2048 pts)
              </span>
            </div>

            {/* Signal indicator */}
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  isListening
                    ? liveRms >= noiseThreshold
                      ? 'bg-emerald-400 shadow-[0_0_10px_#34d399] animate-pulse'
                      : 'bg-amber-400/80'
                    : 'bg-slate-600'
                }`}
              />
              <span className="text-[10px] sm:text-[11px] font-mono font-semibold text-slate-300">
                {isListening
                  ? liveRms >= noiseThreshold
                    ? 'SEÑAL ACTIVA (RMS > Umbral)'
                    : 'SILENCIO / ESPERANDO'
                  : 'MIC INACTIVO'}
              </span>
            </div>
          </div>

          <div className="relative w-full h-32 sm:h-36 rounded-xl overflow-hidden border border-indigo-500/20 bg-[#040615]">
            <canvas ref={canvasRef} width={640} height={144} className="w-full h-full block" />

            {/* Noise Gate threshold label on canvas */}
            <div className="absolute top-2 left-2 text-[10px] font-mono text-rose-400/80 pointer-events-none bg-[#050718]/80 px-1.5 py-0.5 rounded border border-rose-500/30">
              Umbral Ruido: {(noiseThreshold * 100).toFixed(1)}% RMS
            </div>

            {/* Current status pill overlay */}
            <div className="absolute bottom-2 right-2 max-w-[calc(100%-16px)] truncate text-[10px] sm:text-[11px] font-mono text-cyan-300 bg-[#080d28]/90 px-2.5 py-1 rounded-lg border border-cyan-500/30 shadow-md">
              {statusMessage}
            </div>
          </div>

          {/* Real-Time Raw Debug Console Ticker */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#030616] border border-cyan-500/25 text-[11px] font-mono shadow-inner">
            <div className="flex items-center gap-2 truncate">
              <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-slate-400 shrink-0 hidden sm:inline">Lectura en Crudo:</span>
              <span
                className={`font-semibold truncate ${
                  liveFreq !== null ? 'text-emerald-300' : 'text-slate-300'
                }`}
              >
                {rawDebugText}
              </span>
            </div>
            <span className="text-slate-500 shrink-0 text-[10px] hidden md:inline">
              150Hz - 2200Hz &bull; YIN / Autocorrelación
            </span>
          </div>
        </div>

        {/* Live Metrics: Frequency, MIDI, Note Name & LED VU Meter */}
        <div className="bg-[#06091f]/90 border border-indigo-500/20 rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between backdrop-blur-md shadow-xl space-y-3">
          <div className="text-xs font-mono text-slate-300 font-semibold uppercase tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Frecuencia & Nota</span>
            </div>
            {liveConfidence > 0 && (
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                Conf: {(liveConfidence * 100).toFixed(0)}%
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Live Note Name */}
            <div className="bg-[#090d29] p-2.5 sm:p-3 rounded-xl border border-indigo-500/25 flex flex-col items-center justify-center">
              <span className="text-[10px] font-mono text-slate-400">Nota Musical</span>
              <span className="text-xl sm:text-2xl font-black font-mono text-cyan-300 tracking-wider">
                {liveNoteName}
              </span>
            </div>

            {/* Live MIDI number */}
            <div className="bg-[#090d29] p-2.5 sm:p-3 rounded-xl border border-indigo-500/25 flex flex-col items-center justify-center">
              <span className="text-[10px] font-mono text-slate-400">MIDI / ASCII</span>
              <span className="text-xl sm:text-2xl font-black font-mono text-indigo-200 tracking-wider">
                {liveMidi !== null ? liveMidi : '---'}
              </span>
            </div>
          </div>

          {/* Hertz Display */}
          <div className="bg-[#090d29] p-2.5 rounded-xl border border-indigo-500/25 flex items-center justify-between px-3 sm:px-4">
            <span className="text-xs font-mono text-slate-400">Frecuencia:</span>
            <span className="text-sm sm:text-base font-bold font-mono text-white">
              {liveFreq !== null ? `${liveFreq.toFixed(1)} Hz` : '--- Hz'}
            </span>
          </div>

          {/* Segmented LED VU Meter */}
          <div className="space-y-1.5 bg-[#090d29] p-2.5 rounded-xl border border-indigo-500/25">
            <div className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-slate-400 flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    liveRms >= noiseThreshold ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
                  }`}
                />
                <span>Vúmetro RMS: {(liveRms * 100).toFixed(1)}%</span>
              </span>
              <span
                className={`font-semibold ${
                  liveRms >= noiseThreshold ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {liveRms >= noiseThreshold ? 'AUDIO CAPTADO' : 'SILENCIO'}
              </span>
            </div>

            {/* 12-Segment LED Visualizer */}
            <div className="grid grid-cols-12 gap-1 h-3 p-1 rounded-lg bg-[#040615] border border-indigo-500/30">
              {Array.from({ length: 12 }).map((_, idx) => {
                const stepRms = ((idx + 1) / 12) * 0.1;
                const isLit = liveRms >= stepRms;
                let colorClass = 'bg-slate-800';
                if (isLit) {
                  if (idx < 6) {
                    colorClass = 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]';
                  } else if (idx < 9) {
                    colorClass = 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]';
                  } else {
                    colorClass = 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]';
                  }
                }
                return (
                  <div
                    key={idx}
                    className={`rounded-sm transition-colors duration-75 ${colorClass}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] font-mono text-slate-500 px-0.5">
              <span>0%</span>
              <span className="text-rose-400/80">Umbral ({(noiseThreshold * 100).toFixed(1)}%)</span>
              <span>10%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Progressive Revelation Card: Letras Reconstruidas */}
      <div className="bg-[#06091f]/90 border border-indigo-500/20 rounded-2xl p-3.5 sm:p-5 backdrop-blur-md shadow-xl space-y-3 sm:space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 border-b border-indigo-500/20 pb-3">
          <div>
            <h3 className="text-xs sm:text-sm font-semibold font-mono text-white tracking-wider uppercase flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Revelación Progresiva del Nombre</span>
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-400 font-mono">
              Las letras emergen conforme se valida cada tono por autocorrelación
            </p>
          </div>

          {/* Letter count badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] sm:text-xs font-mono px-2.5 sm:px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-500/30 text-indigo-300">
              {decodedLetters.length} {decodedLetters.length === 1 ? 'letra captada' : 'letras captadas'}
            </span>

            {isSequenceCompleted && (
              <span className="text-[10px] sm:text-xs font-mono px-2.5 sm:px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Secuencia Cerrada</span>
              </span>
            )}
          </div>
        </div>

        {/* Letters Tape */}
        {decodedLetters.length === 0 ? (
          <div className="py-8 sm:py-12 flex flex-col items-center justify-center text-center space-y-2 border border-dashed border-indigo-500/25 rounded-xl bg-[#080d28]/40 px-4">
            <Radio className="w-8 h-8 text-cyan-400/50 animate-pulse" />
            <p className="text-xs sm:text-sm font-mono text-slate-300">Ninguna nota detectada aún</p>
            <p className="text-[11px] sm:text-xs font-mono text-slate-400/70 max-w-md">
              Activa el micrófono y reproduce la firma sonora en otro teléfono. Cada tono se
              decodificará automáticamente aquí.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-indigo-500/40">
            <div className="flex items-stretch gap-2 sm:gap-2.5 min-w-max">
              {decodedLetters.map((l, idx) => (
                <motion.div
                  key={l.id}
                  initial={{ opacity: 0, scale: 0.8, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="relative flex flex-col items-center justify-between p-2.5 sm:p-3 rounded-xl border border-cyan-400/50 bg-gradient-to-b from-indigo-950/70 via-[#0a0f30] to-[#0c143c] min-w-[78px] sm:min-w-[88px] shadow-[0_0_15px_rgba(6,182,212,0.25)] select-none"
                >
                  {/* Step order */}
                  <span className="text-[9px] sm:text-[10px] font-mono text-indigo-300/80 font-semibold">
                    Paso {idx + 1}
                  </span>

                  {/* Decoded Character */}
                  <div className="my-1 text-2xl sm:text-3xl font-black font-mono text-cyan-200 drop-shadow-[0_0_10px_rgba(56,189,248,0.8)]">
                    {l.char}
                  </div>

                  {/* ASCII & MIDI */}
                  <div className="text-[10px] sm:text-[11px] font-mono text-cyan-300 bg-[#060b22] px-1.5 sm:px-2 py-0.5 rounded border border-cyan-500/30 mb-1 sm:mb-1.5 shadow-inner">
                    ASCII {l.ascii}
                  </div>

                  {/* Musical Note & Hz */}
                  <div className="flex flex-col items-center text-center">
                    <div className="flex items-center gap-1 text-[11px] sm:text-xs font-semibold font-mono text-white">
                      <Music className="w-3 h-3 text-sky-400 shrink-0" />
                      <span>{l.noteName}</span>
                    </div>
                    <div className="text-[9px] sm:text-[10px] font-mono text-slate-400">
                      {l.frequency.toFixed(1)} Hz
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 5. Result Reconstructed Word Card & Cartesian Auto-Graphing */}
      {completedWord.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="bg-gradient-to-br from-[#060b28] via-[#091138] to-[#06091f] border-2 border-cyan-400/40 rounded-2xl p-4 sm:p-6 shadow-2xl backdrop-blur-md space-y-4 sm:space-y-6"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-indigo-500/30 pb-4">
            <div>
              <span className="text-[10px] sm:text-[11px] font-mono text-cyan-300 uppercase tracking-widest flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Nombre Completo Reconstruido por el Aire</span>
              </span>
              <h3 className="text-2xl sm:text-4xl font-black font-mono tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-200 via-sky-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(56,189,248,0.5)] uppercase mt-1 break-all">
                {completedWord}
              </h3>
            </div>

            {/* Actions for the Reconstructed Word */}
            <div className="grid grid-cols-1 sm:flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
              <button
                id="btn-copy-decoded-word"
                type="button"
                onClick={handleCopyWord}
                className="w-full sm:w-auto justify-center px-4 py-2.5 rounded-xl bg-[#0c1544] hover:bg-cyan-950/60 border border-cyan-500/40 text-cyan-200 font-mono text-xs flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-95"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? '¡Copiado!' : 'Copiar Texto'}</span>
              </button>

              <button
                id="btn-send-to-emitter"
                type="button"
                onClick={() => onSendToEmitter(completedWord)}
                className="w-full sm:w-auto justify-center px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white font-mono text-xs font-semibold flex items-center gap-2 shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-all cursor-pointer active:scale-95"
              >
                <span>Cargar en Modo Emisor</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Automatic Cartesian Curve Display of Reconstructed Name */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 font-mono flex items-center gap-2">
                <LineChart className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Curva Cartesiana Interpolada</span>
              </h4>
              <span className="text-[10px] sm:text-[11px] font-mono text-slate-400">
                Polinomio generado a partir de las notas captadas
              </span>
            </div>

            <div className="h-[260px] sm:h-[320px]">
              <CartesianCanvas
                points={completedPoints}
                mode="lagrange"
                audioProgress={0}
                activeStep={-1}
                isPlaying={false}
              />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
