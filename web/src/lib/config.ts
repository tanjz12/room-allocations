/** Everything specific to one organization lives here and comes from the data package; the defaults are empty. */
export type MapRoomMeta = { orig: string; box: number[]; added?: boolean; glyphs?: number };
export type MapMeta = { rooms: Record<string, MapRoomMeta[]>; legend: { x: number; y: number; w: number; h: number; step: number }; width: number; height: number };
/** `keepOrig`: rooms that keep their template color when unused; `labels`: label text for added room labels (default: id without its leading capitals). */
/** A legend entry for shapes that aren't rooms (stairs, elevators…), shared by all floor plans. */
export type LegendExtra = { key: string; label: string; color: string };
export type MapDef = { name: string; svg: string; meta: MapMeta; floor: string; legendSlots: number; keepOrig?: string[]; legendExtra?: LegendExtra[]; legendKeys?: string[]; labels?: Record<string, string> };
/** A set of events shown together on Floor plans with counts and percentages of a projected total. */
export type Highlight = { label: string; title: string; eventIds: string[]; leadId?: string; projectedDefault: number };
/** Events listed together under one heading on Events, sharing start/end. */
export type Subgroup = { name: string; eventIds: string[]; afterId?: string };
/** A count line in a proctor pill: rooms used by `eventIds` (none = rooms at the pill's busiest slot), optionally only the rooms listed one by one or only the others. */
export type ProctorLine = { label: string; eventIds: string[]; rooms?: 'listed' | 'others' };
/** Where a pill's time range starts or ends: a phase's start or end, or a time in minutes. Missing = start / end of the day. */
export type PillBound = { phaseId: string; edge: 'start' | 'end' } | { time: number };
/** A proctor pill counts rooms in use for `group` events (minus `excludeIds`) at the busiest slot of its time range (whole day if none). */
export type ProctorPill = { id: string; name: string; group: string; excludeIds: string[]; from?: PillBound; to?: PillBound; lines: ProctorLine[] };
/** Picks rooms by a text field: `room` matches a room id; `type` also matches “Large (names)” as Large. */
export type RoomMatch = { field: 'type' | 'building' | 'status' | 'room'; value: string };
/** Proctor summary: rooms matching `listed` are shown one by one with editable counts; one pill per entry in `pills`; min / ideal capacity types give proctors per room. */
export type Proctors = {
  minCap: string; idealCap: string; listed: RoomMatch[]; pills: ProctorPill[]; note?: string;
};
/** Floor plans (color by event): rooms with any of these event groups or events share one color. */
export type SameColor = { id: string; name: string; color: string; groups: string[]; eventIds: string[] };
/** A saved set of same-color groupings, offered in the floor plans' Show menu. */
export type ColorOption = { id: string; name: string; colors: SameColor[] };
/** A room status option; `color` matches its dropdown chip in the source Google Sheet. Only rooms set to Yes are scheduled or counted. */
export type RoomStatus = { name: string; color: string };
export const DEFAULT_ROOM_STATUSES: RoomStatus[] = [
  { name: 'Yes', color: '#11734b' }, { name: 'Need to Request', color: '#0a53a8' }, { name: 'Awaiting Approval', color: '#5a3286' }, { name: 'No', color: '#b10202' }
];

export type Config = {
  title: string; roomTypes: string[]; eventGroups: string[]; eventOrder: string[];
  subgroup?: Subgroup; highlight?: Highlight; summaryEventIds: string[]; proctors?: Proctors; sameColors?: SameColor[]; colorOptions?: ColorOption[];
  maps: MapDef[]; notes?: Record<string, string>;
  drive?: DriveConfig; sheetTypeFill?: Record<string, string>;
  /** Room type rules: a room following the rules gets the first type (in `roomTypes` order) whose condition on [Raw] is true. */
  typeRules?: Record<string, string>;
  legendExtras?: LegendExtra[];
  roomStatuses?: RoomStatus[];
  /** Phase timelines this data uses (none on a blank site), e.g. BMT's External and Internal schedules. */
  phaseSchedules?: PhaseSchedule[];
  /** Key of the phase schedule whose times events linked to a phase follow. */
  alignSchedule?: string;
  /** Folder generated maps were last saved to on Drive. */
  mapsFolder?: DriveFolder;
  signs?: SignConfig;
};
/** Room signs: `logo` is a PNG/JPEG data URL; `color` fills the room-number box. */
/** Logo box in points: `logoSize` square, `logoX` its center from the left, `logoY` its top. */
export type SignConfig = { logo?: string; footer?: string; heading?: string; color?: string; fileName?: string; driveFolder?: DriveFolder; logoSize?: number; logoX?: number; logoY?: number; boxStretch?: boolean; boxGap?: number; typst?: TypstConfig; font?: SignFontFile; numberFont?: SignFontFile };
/** A Typst file saved to Drive from the Typst editor. */
export type TypstDriveFile = { id: string; name: string; folderId: string };
/** Typst editor: `code` is unset until edited (the editor then shows code generated from the basic editor); `files` are extra uploads (base64). */
export type TypstConfig = { code?: string; fileName?: string; files?: { name: string; data: string }[]; drive?: TypstDriveFile; driveFiles?: TypstDriveFile[] };
/** Styling for a room's sign note. `font` picks the event font or the room-number font; bold and italic are drawn by the app (no extra font files). */
export type NoteStyle = { size?: number; font?: 'text' | 'number'; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean };
/** An uploaded TrueType font: `name` is its family name (also used in Google Slides), `data` the .ttf as base64. */
export type SignFontFile = { name: string; data: string; google?: { family: string; weight: number } };
/** Per-room sign overrides; blank fields fall back to the room's building and name. */
export type RoomSign = { building?: string; floor?: string; label?: string; copies?: number; note?: string; hide?: boolean; noteStyle?: NoteStyle };
/** Where Save/Load to Drive reads and writes; access is whatever the signed-in Google account has on these files. */
export type DriveConfig = { folderId: string; jsonName: string; sheetName: string; fileId?: string; sheetId?: string };
/** A Drive folder picked for saving outputs; the package remembers it as the default for next time. */
export type DriveFolder = { id: string; name: string };
export const DEFAULT_TITLE = 'Room Allocation';
/** The part of the site title users edit in the header (the text before “Room Allocation”). */
export const headerPrefix = (title: string) => { const t = title || DEFAULT_TITLE; return t.endsWith(DEFAULT_TITLE) ? t.slice(0, -DEFAULT_TITLE.length).trim() : t; };
/** Default export file name: the header prefix, then `base`, words joined by dashes. */
export const exportName = (title: string, base: string) =>
  [headerPrefix(title), base].join(' ').replace(/[\\/:*?"<>|]+/g, ' ').trim().split(/\s+/).join('-');
export const emptyConfig = (): Config => ({ title: DEFAULT_TITLE, roomTypes: [], eventGroups: [], eventOrder: [], summaryEventIds: [], maps: [] });

export type PhaseSchedule = { key: string; name: string };

/** Moves per-map legend entries (older packages, new uploads) into the shared list, matching by key, then by label. */
export function mergeLegendExtras(cfg: Config) {
  for (const m of cfg.maps) {
    if (!m.legendExtra) continue;
    const all = (cfg.legendExtras ??= []);
    for (const x of m.legendExtra) {
      const lab = x.label.trim().toLowerCase();
      let g = all.find((y) => y.key === x.key) ?? all.find((y) => !!lab && y.label.trim().toLowerCase() === lab);
      if (!g) all.push(g = { ...x });
      else if (g.key !== x.key) m.svg = m.svg.split(`data-extra="${x.key}"`).join(`data-extra="${g.key}"`);
      if (!m.legendKeys?.includes(g.key)) m.legendKeys = [...(m.legendKeys ?? []), g.key];
    }
    delete m.legendExtra;
  }
}
