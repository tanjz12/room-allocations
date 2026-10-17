/** Everything specific to one organization lives here and comes from the data package; the defaults are empty. */
export type MapRoomMeta = { orig: string; box: number[]; added?: boolean; glyphs?: number };
export type MapMeta = { rooms: Record<string, MapRoomMeta[]>; legend: { x: number; y: number; w: number; h: number; step: number }; width: number; height: number };
/** `keepOrig`: rooms that keep their template color when unused; `labels`: label text for added room labels (default: id without its leading capitals). */
export type MapDef = { name: string; svg: string; meta: MapMeta; floor: string; legendSlots: number; keepOrig?: string[]; legendExtra?: { key: string; label: string; color: string }[]; labels?: Record<string, string> };
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
/** Events in `eventIds` need `minutes` free before and after them in the same room. */
export type Spacing = { eventIds: string[]; minutes: number; label: string };
/** Floor plans (color by event): rooms with any of these event groups or events share one color. */
export type SameColor = { id: string; name: string; color: string; groups: string[]; eventIds: string[] };
/** A saved set of same-color groupings, offered in the floor plans' Show menu. */
export type ColorOption = { id: string; name: string; colors: SameColor[] };
export type Config = {
  title: string; roomTypes: string[]; eventGroups: string[]; eventOrder: string[];
  subgroup?: Subgroup; highlight?: Highlight; summaryEventIds: string[]; proctors?: Proctors; spacing?: Spacing; sameColors?: SameColor[]; colorOptions?: ColorOption[];
  maps: MapDef[]; notes?: Record<string, string>;
  drive?: DriveConfig; sheetTypeFill?: Record<string, string>;
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
export type SignConfig = { logo?: string; footer?: string; heading?: string; color?: string; fileName?: string; driveFolder?: DriveFolder; logoSize?: number; logoX?: number; logoY?: number; font?: SignFontFile; numberFont?: SignFontFile };
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
export const emptyConfig = (): Config => ({ title: DEFAULT_TITLE, roomTypes: [], eventGroups: [], eventOrder: [], summaryEventIds: [], maps: [] });

export type PhaseSchedule = { key: string; name: string };
