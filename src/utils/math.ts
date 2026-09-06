import { LetterPoint, FourierCoefficients } from '../types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Converts MIDI note number to note name (e.g. 69 -> "A4", 60 -> "C4")
 */
export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Calculates frequency in Hz from MIDI note:
 * f = 440 * 2^((MIDI - 69) / 12)
 */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Resolves a character to its standard ASCII code, normalizing diacritics if outside 7-bit ASCII
 */
export function getAsciiCode(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) {
    return code;
  }
  // Normalize diacritics (e.g., Á -> A, É -> E, Ñ -> N)
  const normalized = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalized.length > 0) {
    const normCode = normalized.charCodeAt(0);
    if (normCode >= 32 && normCode <= 126) {
      return normCode;
    }
  }
  return code <= 127 ? code : 65 + (code % 26);
}

/**
 * Converts input string into array of data points
 */
export function parseWordToPoints(word: string): LetterPoint[] {
  const sanitized = (word && word.length > 0 ? word : 'ALTAIR').slice(0, 32);
  const chars = Array.from(sanitized);

  if (chars.length === 0) {
    return [];
  }

  const asciiValues = chars.map(getAsciiCode);
  const minAscii = Math.min(...asciiValues);
  const maxAscii = Math.max(...asciiValues);
  const range = maxAscii === minAscii ? 1 : maxAscii - minAscii;

  return chars.map((char, index) => {
    const ascii = getAsciiCode(char);
    // Standard direct MIDI mapping from ASCII
    const midiNote = ascii;
    const frequency = midiToFrequency(midiNote);
    const normalized = (ascii - minAscii) / range;

    return {
      index,
      char,
      ascii,
      midiNote,
      noteName: midiToNoteName(midiNote),
      frequency,
      normalized,
    };
  });
}

/**
 * Evaluates Lagrange polynomial at point x
 */
export function evaluateLagrange(points: LetterPoint[], x: number): number {
  const n = points.length;
  if (n === 0) return 0;
  if (n === 1) return points[0].ascii;

  let result = 0;
  for (let i = 0; i < n; i++) {
    const xi = points[i].index;
    const yi = points[i].ascii;
    let term = yi;

    for (let j = 0; j < n; j++) {
      if (i !== j) {
        const xj = points[j].index;
        term *= (x - xj) / (xi - xj);
      }
    }
    result += term;
  }
  return result;
}

/**
 * Computes Discrete Fourier Transform coefficients for harmonic approximation
 */
export function computeFourierCoefficients(points: LetterPoint[]): FourierCoefficients {
  const N = points.length;
  if (N === 0) {
    return { a0: 0, a: [], b: [], harmonics: 0 };
  }

  // Mean (DC offset)
  const a0 = points.reduce((sum, p) => sum + p.ascii, 0) / N;

  const harmonics = Math.min(Math.floor(N / 2), 16);
  const a: number[] = [];
  const b: number[] = [];

  for (let k = 1; k <= harmonics; k++) {
    let sumCos = 0;
    let sumSin = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      sumCos += points[n].ascii * Math.cos(angle);
      sumSin += points[n].ascii * Math.sin(angle);
    }
    a.push((2 / N) * sumCos);
    b.push((2 / N) * sumSin);
  }

  return { a0, a, b, harmonics };
}

/**
 * Evaluates Fourier trigonometric series at point x
 */
export function evaluateFourier(coeffs: FourierCoefficients, N: number, x: number): number {
  if (N <= 0) return 0;
  let val = coeffs.a0;
  for (let k = 1; k <= coeffs.harmonics; k++) {
    const a_k = coeffs.a[k - 1];
    const b_k = coeffs.b[k - 1];
    const angle = (2 * Math.PI * k * x) / N;
    val += a_k * Math.cos(angle) + b_k * Math.sin(angle);
  }
  return val;
}

/**
 * Generates PeriodicWave coefficients (Float32Array) for Web Audio API
 */
export function generatePeriodicWaveArrays(points: LetterPoint[]): { real: Float32Array; imag: Float32Array } {
  const N = Math.max(points.length, 2);
  const numHarmonics = Math.min(32, Math.max(8, N * 2));

  const real = new Float32Array(numHarmonics);
  const imag = new Float32Array(numHarmonics);

  // PeriodicWave expects real[0] and imag[0] to be 0 (DC removed)
  real[0] = 0;
  imag[0] = 0;

  // Center values around 0
  const mean = points.reduce((sum, p) => sum + p.ascii, 0) / points.length;
  const centered = points.map((p) => p.ascii - mean);

  for (let k = 1; k < numHarmonics; k++) {
    let r = 0;
    let im = 0;
    for (let n = 0; n < points.length; n++) {
      const angle = (2 * Math.PI * k * n) / points.length;
      r += centered[n] * Math.cos(angle);
      im += centered[n] * Math.sin(angle);
    }
    // Dampen higher harmonics slightly for smooth warm resonance
    const harmonicDamping = 1 / Math.sqrt(k);
    real[k] = (r / points.length) * harmonicDamping;
    imag[k] = (im / points.length) * harmonicDamping;
  }

  return { real, imag };
}
