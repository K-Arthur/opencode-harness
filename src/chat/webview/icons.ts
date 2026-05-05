// ═══════════════════════════════════════════════════════════════════
// Premium Icon Set — Consistent 1.5px stroke, rounded caps/joins
// Style inspired by Phosphor/Tabler iconography
// ═══════════════════════════════════════════════════════════════════

const SVG = (content: string, size = 16, fill = "none") =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`

const SVG_FILL = (content: string, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" stroke="none" aria-hidden="true">${content}</svg>`

// ─── Brand / Identity ───
export const OC_LOGO_SVG = `<svg class="oc-logo" viewBox="0 0 480 600" width="20" height="20" fill="none" stroke="currentColor" stroke-width="48" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="60" y="60" width="360" height="480" rx="24"/><rect x="180" y="180" width="120" height="240" rx="12"/></svg>`

// ─── Avatars ───
export const USER_AVATAR_SVG = SVG(`<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/>`, 16)

// ─── Header Toolbar ───
export const HISTORY_SVG = SVG(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`, 16)
export const NEW_TAB_SVG = SVG(`<path d="M12 5v14M5 12h14"/>`, 16)
export const MCP_SVG = SVG(`<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>`, 16)
export const SETTINGS_SVG = SVG(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`, 16)

// ─── Welcome Screen Prompt Starters ───
export const FOLDER_SVG = SVG(`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`, 18)
export const BUG_SVG = SVG(`<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 6"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9 4 11.27"/><path d="M17.47 9 20 11.27"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M6.53 17 4 14.73"/><path d="M17.47 17 20 14.73"/>`, 18)
export const REFRESH_SVG = SVG(`<path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>`, 18)
export const TEST_SVG = SVG(`<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/>`, 18)

// ─── Input Area ───
export const MENTION_SVG = SVG(`<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>`, 14)
export const ATTACH_SVG = SVG(`<path d="M6 7.5a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v7a6 6 0 0 1-12 0v-4"/><path d="M12 15V7.5"/>`, 14)
export const SEND_SVG = SVG(`<path d="m5 12 7-7 7 7"/><path d="M12 5v14"/>`, 16)
export const STOP_SVG = SVG(`<rect x="6" y="6" width="12" height="12" rx="2"/>`, 16)
export const CHEVRON_DOWN_SVG = SVG(`<path d="m6 9 6 6 6-6"/>`, 12)

// ─── Search Bar ───
export const SEARCH_PREV_SVG = SVG(`<path d="m18 15-6-6-6 6"/>`, 14)
export const SEARCH_NEXT_SVG = SVG(`<path d="m6 9 6 6 6-6"/>`, 14)
export const SEARCH_CLOSE_SVG = SVG(`<path d="M18 6 6 18"/><path d="M6 6l12 12"/>`, 14)

// ─── Model Manager ───
export const SEARCH_SVG = SVG(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`, 16)
export const CLOSE_SVG = SVG(`<path d="M18 6 6 18"/><path d="M6 6l12 12"/>`, 18)
export const PLUS_SVG = SVG(`<path d="M12 5v14"/><path d="M5 12h14"/>`, 14)
export const CHECK_SVG = SVG(`<path d="m20 6-9 9-5-5"/>`, 14)

// ─── Tool Call Icons ───
export const TOOL_READ_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`, 16)
export const TOOL_WRITE_SVG = SVG(`<path d="M12 20h9a2 2 0 0 0 2-2v-9"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`, 16)
export const TOOL_EXEC_SVG = SVG(`<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`, 16)
export const TOOL_META_SVG = SVG(`<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>`, 16)

// ─── Message / Diff Actions ───
export const COPY_SVG = SVG(`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`, 14)
export const INSERT_SVG = SVG(`<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`, 14)
export const NEW_FILE_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15h6"/>`, 14)
export const EDIT_SVG = SVG(`<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>`, 12)
export const REMOVE_SVG = SVG(`<path d="M18 6 6 18"/><path d="M6 6l12 12"/>`, 10)

// ─── Status / Feedback ───
export const BRAIN_SVG = SVG(`<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v0a2.5 2.5 0 0 1-2.5 2.5"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v0a2.5 2.5 0 0 0 2.5 2.5"/><path d="M9.5 21A2.5 2.5 0 0 0 12 18.5v0a2.5 2.5 0 0 0-2.5-2.5"/><path d="M14.5 21A2.5 2.5 0 0 1 12 18.5v0a2.5 2.5 0 0 1 2.5-2.5"/><path d="M7 7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3z"/><path d="M7 17a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v0a3 3 0 0 0-3-3H10a3 3 0 0 0-3 3z"/>`, 16)
export const SUCCESS_SVG = SVG_FILL(`<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>`, 16)
export const ERROR_SVG = SVG_FILL(`<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>`, 16)
export const WARNING_SVG = SVG(`<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`, 16)
export const SPINNER_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`

// ─── Expand / Collapse ───
export const CHEVRON_RIGHT_SVG = SVG(`<path d="m9 18 6-6-6-6"/>`, 12)

// ─── Misc ───
export const SPARKLE_SVG = SVG(`<path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5z"/><path d="m5 16-1 2.5L1.5 20l2.5 1L5 23.5l1-2.5 2.5-1-2.5-1z"/>`, 16)
export const SHARE_SVG = SVG(`<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>`, 16)
export const PLAY_SVG = SVG(`<path d="m5 3 14 9-14 9z"/>`, 16)
export const COMMAND_SVG = SVG(`<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>`, 16)
export const DOWNLOAD_SVG = SVG(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>`, 16)
export const CODE_SVG = SVG(`<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`, 16)
export const MONITOR_SVG = SVG(`<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>`, 16)
export const EXPAND_SVG = SVG(`<path d="m15 3 6 6"/><path d="m9 21-6-6"/><path d="m21 9-6 6"/><path d="m3 15 6-6"/>`, 16)
export const USER_PLUS_SVG = SVG(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>`, 16)
export const TERMINAL_SVG = SVG(`<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`, 16)
export const TRASH_SVG = SVG(`<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`, 14)
export const GEAR_SVG = SVG(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`, 12)
