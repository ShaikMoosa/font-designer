// Minimal typings for the opentype.js surface this app uses (the package
// ships no TypeScript declarations).
declare module "opentype.js" {
  export class Path {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    closePath(): void;
  }
  export interface GlyphOptions {
    name: string;
    unicode?: number;
    advanceWidth: number;
    path: Path;
  }
  export class Glyph {
    constructor(options: GlyphOptions);
    name: string;
  }
  export interface FontOptions {
    familyName: string;
    styleName: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: Glyph[];
  }
  export class Font {
    constructor(options: FontOptions);
    kerningPairs: Record<string, number>;
    toArrayBuffer(): ArrayBuffer;
  }
  const opentype: { Path: typeof Path; Glyph: typeof Glyph; Font: typeof Font };
  export default opentype;
}
