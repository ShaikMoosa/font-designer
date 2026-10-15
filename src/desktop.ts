// Desktop bridge for the Electron shell (Phase 6). In a browser every
// helper reports "not desktop" and callers fall back to the existing
// <input type=file> / download behaviour, so the web build is unchanged.

export interface DesktopFileFilter {
  name: string;
  extensions: string[];
}

export interface DesktopOpenResult {
  name: string;
  kind: "text" | "binary";
  text?: string;
  base64?: string;
}

export interface DesktopSaveRequest {
  defaultName: string;
  filters: DesktopFileFilter[];
  text?: string;
  base64?: string;
}

export interface DesktopSaveResult {
  saved: boolean;
  path?: string;
  name?: string;
}

export interface GlyphsDesktopBridge {
  isDesktop: boolean;
  platform: string;
  openFile: () => Promise<DesktopOpenResult | null>;
  saveFile: (request: DesktopSaveRequest) => Promise<DesktopSaveResult>;
  onMenuCommand: (callback: (command: string) => void) => () => void;
}

declare global {
  interface Window {
    glyphsDesktop?: GlyphsDesktopBridge;
  }
}

export function desktopBridge(): GlyphsDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.glyphsDesktop ?? null;
}

export function isDesktop(): boolean {
  return desktopBridge()?.isDesktop === true;
}

/** UFO exports arrive as .zip (binary); .glyphs/.json open as text. */
export function fileKindForName(name: string): "text" | "binary" {
  return /\.zip$/i.test(name) ? "binary" : "text";
}

export function filtersForFileName(name: string): DesktopFileFilter[] {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const known: Record<string, string> = {
    glyphs: "Glyphs font",
    json: "JSON",
    zip: "ZIP archive",
    otf: "OpenType font",
    ttf: "TrueType font",
    woff: "WOFF font",
    woff2: "WOFF2 font",
  };
  if (ext && known[ext]) return [{ name: known[ext], extensions: [ext] }];
  return [{ name: "All files", extensions: ["*"] }];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function desktopOpenFile(): Promise<DesktopOpenResult | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  return bridge.openFile();
}

/** Returns null in a browser (caller falls back), otherwise the dialog result. */
export async function desktopSaveText(
  defaultName: string,
  text: string,
): Promise<DesktopSaveResult | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  return bridge.saveFile({ defaultName, text, filters: filtersForFileName(defaultName) });
}

export async function desktopSaveBytes(
  defaultName: string,
  bytes: Uint8Array,
): Promise<DesktopSaveResult | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  return bridge.saveFile({
    defaultName,
    base64: bytesToBase64(bytes),
    filters: filtersForFileName(defaultName),
  });
}

export function onDesktopMenuCommand(callback: (command: string) => void): () => void {
  const bridge = desktopBridge();
  if (!bridge) return () => undefined;
  return bridge.onMenuCommand(callback);
}
