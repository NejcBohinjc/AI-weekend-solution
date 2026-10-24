// Shared by the schema (drizzle-kit) and the app, so no imports with the @/ alias here.

/** timer: Start/Stop. manual: added by hand. seed: sandbox history from data/hours.xlsx (never sent to the sheet). */
export const TIME_ENTRY_SOURCES = ["timer", "manual", "seed"] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

/** pending: the sheet must be updated. synced: the sheet matches. skip: never goes to the sheet. */
export const SHEET_STATUSES = ["pending", "synced", "skip"] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];

/** Stopping a timer that ran longer than this asks when the member actually stopped. */
export const FORGOTTEN_TIMER_HOURS = 12;
/** Timer runs shorter than this are discarded (an accidental tap on Start). */
export const MIN_ENTRY_SECONDS = 60;
/** Longest single entry that can be saved. */
export const MAX_ENTRY_HOURS = 24;
