import { STATE_VERSION, type State } from './model';
import { sanitizeSvg } from './maps';
import { isSvgLogo, svgLogoText, svgLogoUrl, validFont, validLogo } from './signs';

/** A data package is one JSON file holding the whole app: rooms, events, tags, rules and floor plans. */
export const PACKAGE_FORMAT = 'room-allocation-package';
export type Package = { format: typeof PACKAGE_FORMAT; version: number; exportedAt: string; state: State };

export const makePackage = (state: State): Package => ({ format: PACKAGE_FORMAT, version: STATE_VERSION, exportedAt: new Date().toISOString(), state });

const gzip = (b: Blob) => new Response(b.stream().pipeThrough(new CompressionStream('gzip'))).blob();

/** Exported gzipped (.json.gz): the floor-plan SVGs compress to about a third. */
export async function packageFile(state: State) {
  const blob = new Blob([await gzip(new Blob([JSON.stringify(makePackage(state))]))], { type: 'application/gzip' });
  const slug = (state.config.title || 'room-allocation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { blob, name: `${slug || 'room-allocation'}-package.json.gz` };
}

/** Reads a package file, gzipped or plain JSON. */
export async function packageText(b: Blob): Promise<string> {
  const head = new Uint8Array(await b.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) return new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return b.text();
}

/** Accepts a package, a Drive save ({ savedAt, state }) or a bare state object. */
export function readPackage(text: string): Partial<State> {
  const j = JSON.parse(text);
  const s = j && typeof j === 'object' && j.state && typeof j.state === 'object' ? j.state : j;
  if (!s || typeof s !== 'object' || !Array.isArray(s.rooms)) throw new Error('it is not a room allocation data package');
  for (const m of s.config?.maps ?? []) m.svg = sanitizeSvg(String(m.svg ?? ''));
  if (s.config?.signs && !validLogo(s.config.signs.logo)) delete s.config.signs.logo;
  if (s.config?.signs?.logo && isSvgLogo(s.config.signs.logo)) s.config.signs.logo = svgLogoUrl(svgLogoText(s.config.signs.logo));
  if (s.config?.signs?.font && !validFont(s.config.signs.font)) delete s.config.signs.font;
  // Packages from before phase schedules were configurable always had External + Internal.
  if (s.config && !s.config.phaseSchedules && s.phases?.length) { s.config.phaseSchedules = [{ key: 'ext', name: 'External' }, { key: 'int', name: 'Internal' }]; s.config.alignSchedule ??= 'ext'; }
  if (s.config?.signs?.numberFont && !validFont(s.config.signs.numberFont)) delete s.config.signs.numberFont;
  return s as Partial<State>;
}
