// App-level settings (Phase 12, slice 1) and preview sample strings.
// Pure and storage-agnostic: callers pass the raw stored JSON in and keep
// the serialized result, so this module stays unit-testable without a DOM.

export interface AppSettings {
  compileServiceUrl: string;
  defaultPreviewSize: number;
  showGuides: boolean;
  showNodes: boolean;
  customSamples: string[];
}

export const DEFAULT_COMPILE_SERVICE = "http://127.0.0.1:8765";

export const DEFAULT_SETTINGS: AppSettings = {
  compileServiceUrl: DEFAULT_COMPILE_SERVICE,
  defaultPreviewSize: 48,
  showGuides: true,
  showNodes: true,
  customSamples: [],
};

export const SETTINGS_KEY = "glyphs-windows.settings.v1";
const MAX_CUSTOM_SAMPLES = 20;
const MAX_SAMPLE_LENGTH = 120;

function cleanUrl(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_COMPILE_SERVICE;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/.test(trimmed)) return DEFAULT_COMPILE_SERVICE;
  return trimmed;
}

function cleanSample(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_SAMPLE_LENGTH);
}

export function normalizeSettings(raw: unknown): AppSettings {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Partial<AppSettings>;
  const size = typeof stored.defaultPreviewSize === "number" ? stored.defaultPreviewSize : Number(stored.defaultPreviewSize);
  const samples = Array.isArray(stored.customSamples)
    ? stored.customSamples.map(cleanSample).filter(Boolean)
    : [];
  return {
    compileServiceUrl: cleanUrl(stored.compileServiceUrl),
    defaultPreviewSize: Number.isFinite(size) ? Math.max(24, Math.min(140, Math.round(size))) : DEFAULT_SETTINGS.defaultPreviewSize,
    showGuides: stored.showGuides !== false,
    showNodes: stored.showNodes !== false,
    customSamples: [...new Set(samples)].slice(0, MAX_CUSTOM_SAMPLES),
  };
}

export function parseSettings(json: string | null): AppSettings {
  if (!json) return { ...DEFAULT_SETTINGS, customSamples: [] };
  try {
    return normalizeSettings(JSON.parse(json) as unknown);
  } catch {
    return { ...DEFAULT_SETTINGS, customSamples: [] };
  }
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(normalizeSettings(settings));
}

/** Add a custom sample (deduped, capped). Returns a new settings object. */
export function addCustomSample(settings: AppSettings, text: string): AppSettings {
  const sample = cleanSample(text);
  const next = normalizeSettings(settings);
  if (!sample || next.customSamples.includes(sample)) return next;
  return { ...next, customSamples: [...next.customSamples, sample].slice(-MAX_CUSTOM_SAMPLES) };
}

export function removeCustomSample(settings: AppSettings, text: string): AppSettings {
  const next = normalizeSettings(settings);
  return { ...next, customSamples: next.customSamples.filter((sample) => sample !== text) };
}

export interface SampleString {
  id: string;
  label: string;
  text: string;
  custom?: boolean;
}

// Built-in proof strings. RTL and complex-script samples are deliberately
// absent: the shaping subset does not reorder or join them, so offering
// them as proofs would misrepresent what the preview can show.
export const SAMPLE_STRINGS: SampleString[] = [
  { id: "latin-mixed", label: "Latin — Hamburgefonstiv", text: "Hamburgefonstiv 123" },
  { id: "latin-pangram", label: "Latin — Pangram", text: "The quick brown fox jumps over the lazy dog" },
  { id: "latin-case", label: "Latin — Upper + lower", text: "ABCDEFGHIJKLM abcdefghijklm NOPQRSTUVWXYZ nopqrstuvwxyz" },
  { id: "figures", label: "Figures + punctuation", text: "0123456789 .,;:!? @#%&*()[]{}" },
  { id: "kerning", label: "Kerning pairs", text: "AV AW AY LT LV LY TA Ta Te Ti To Tr Tu Ty VA Va Ve Vi Vo Vu Wa We Wi Wo Ya Ye Yi Yo Yu" },
  { id: "greek", label: "Greek", text: "ΑΒΓΔΕΖΗΘ αβγδεζηθ Λλ Ξξ Ππ Σσ Φφ Ψψ Ωω" },
  { id: "cyrillic", label: "Cyrillic", text: "АБВГДЕЖЗ абвгдежз Лл Фф Хх Цц Чч Шш Ээ Юю Яя" },
];

export function allSamples(settings: AppSettings): SampleString[] {
  const custom = normalizeSettings(settings).customSamples.map((text, i) => ({
    id: `custom-${i}`,
    label: `Custom — ${text.length > 28 ? `${text.slice(0, 28)}…` : text}`,
    text,
    custom: true,
  }));
  return [...SAMPLE_STRINGS, ...custom];
}
