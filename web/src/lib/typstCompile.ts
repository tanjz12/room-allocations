import { createTypstCompiler, createTypstRenderer, loadFonts, type TypstCompiler, type TypstRenderer } from '@myriaddreamin/typst.ts';
import { CompileFormatEnum } from '@myriaddreamin/typst.ts/compiler';
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url';
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url';

let cached: { key: string; c: Promise<TypstCompiler> } | null = null;
let renderer: Promise<TypstRenderer> | null = null;

/** Fonts are fixed when the compiler starts, so a new font set starts a new compiler. Only the given fonts are used (no downloads). */
function compiler(fonts: Uint8Array[], key: string) {
  if (cached?.key !== key) {
    const c = createTypstCompiler();
    cached = { key, c: c.init({ getModule: () => compilerWasm, beforeBuild: [loadFonts(fonts, { assets: false })] }).then(() => c) };
    cached.c.catch(() => { cached = null; });
  }
  return cached.c;
}
function getRenderer() {
  if (!renderer) {
    const r = createTypstRenderer();
    renderer = r.init({ getModule: () => rendererWasm }).then(() => r);
    renderer.catch(() => { renderer = null; });
  }
  return renderer;
}

export type TypstFile = { path: string; data: Uint8Array };
export type TypstResult = { pdf?: Uint8Array; pages: string[]; errors: string[] };

/** Splits the renderer's stacked SVG into one SVG per page. Glyph definitions and styles go in the first page only; the other pages refer to them by id. */
function splitPages(svg: string): string[] {
  const root = new DOMParser().parseFromString(svg, 'text/html').querySelector('svg.typst-doc');
  if (!root) return [];
  const head = [...root.children].filter((c) => c.tagName.toLowerCase() === 'style' || c.tagName.toLowerCase() === 'defs').map((c) => c.outerHTML).join('');
  return [...root.querySelectorAll(':scope > g.typst-page')].map((g, i) => {
    const w = g.getAttribute('data-page-width') ?? '612', h = g.getAttribute('data-page-height') ?? '792';
    g.removeAttribute('transform');
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" class="typst-doc" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${i ? '' : head}<rect width="100%" height="100%" fill="#fff"/>${g.outerHTML}</svg>`;
  });
}

export async function compileTypst(code: string, files: TypstFile[], fonts: Uint8Array[], fontKey: string): Promise<TypstResult> {
  const c = await compiler(fonts, fontKey);
  c.resetShadow();
  c.addSource('/main.typ', code);
  for (const f of files) c.mapShadow(`/${f.path}`, f.data);
  const pdf = await c.compile({ mainFilePath: '/main.typ', format: CompileFormatEnum.pdf, diagnostics: 'unix' });
  const errors = (pdf.diagnostics ?? []).map(String);
  if (!pdf.result) return { pages: [], errors: errors.length ? errors : ['Typst could not compile this code.'] };
  const vec = await c.compile({ mainFilePath: '/main.typ', format: CompileFormatEnum.vector, diagnostics: 'none' });
  const pages = vec.result ? splitPages(await (await getRenderer()).renderSvg({ format: 'vector', artifactContent: vec.result })) : [];
  return { pdf: pdf.result, pages, errors };
}
