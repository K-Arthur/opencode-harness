// ═══════════════════════════════════════════════════════════════════
// Premium Icon Set — Consistent 1.5px stroke, rounded caps/joins
// Style inspired by Phosphor/Tabler iconography
// ═══════════════════════════════════════════════════════════════════

const SVG = (content: string, size = 16, fill = "none") =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`

const SVG_FILL = (content: string, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" stroke="none" aria-hidden="true">${content}</svg>`

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

// ─── Context Menu / Overflow ───
export const MORE_HORIZONTAL_SVG = SVG(`<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>`, 16)

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
export const BRANCH_SVG = SVG(`<line x1="6" y1="3" x2="6" y2="15"/><circle cx="6" cy="15" r="2"/><path d="M18 9a8 8 0 0 1-8 8"/><circle cx="18" cy="9" r="2"/>`, 14)

// ─── File / Folder ───
export const FILE_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`, 14)
export const EYE_SVG = SVG(`<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`, 12)
export const EYE_OFF_SVG = SVG(`<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`, 12)

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
export const INFO_SVG = SVG(`<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`, 16)
export const SPINNER_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="premium-spinner"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle><circle cx="12" cy="12" r="4" opacity="0.5"><animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite"/></circle></svg>`

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
export const PIN_SVG = SVG(`<path d="M12 2v8"/><path d="M5 10h14l-2 4H7l-2-4z"/><path d="M12 14v8"/>`, 14)
export const PIN_FILLED_SVG = SVG_FILL(`<path d="M12 2a1 1 0 0 1 1 1v7.17l4.95 2.49a1 1 0 0 1 .55 1.34l-1.5 3a1 1 0 0 1-1.34.55L12 15.5l-3.66 2.05a1 1 0 0 1-1.34-.55l-1.5-3a1 1 0 0 1 .55-1.34L11 10.17V3a1 1 0 0 1 1-1zm0 13.5V22a1 1 0 1 1-2 0v-6.5l1 .5 1-.5z"/>`, 14)
export const ARCHIVE_SVG = SVG(`<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>`, 14)
export const TAG_SVG = SVG(`<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`, 14)
export const GEAR_SVG = SVG(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`, 12)

// ═══════════════════════════════════════════════════════════════════
// Sprint 4 — per-tool-name icon taxonomy
// All icons follow the same 1.5px stroke + rounded caps/joins style.
// ═══════════════════════════════════════════════════════════════════

// ─── Activity Kind Icons (replaces emoji in activity-panel.ts) ───
export const MESSAGE_SVG = SVG(`<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>`, 14)
export const THINKING_SVG = SVG(`<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v0a2.5 2.5 0 0 1-2.5 2.5"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v0a2.5 2.5 0 0 0 2.5 2.5"/><path d="M9.5 21A2.5 2.5 0 0 0 12 18.5v0a2.5 2.5 0 0 0-2.5-2.5"/><path d="M14.5 21A2.5 2.5 0 0 1 12 18.5v0a2.5 2.5 0 0 1 2.5-2.5"/><path d="M7 7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3z"/><path d="M7 17a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v0a3 3 0 0 0-3-3H10a3 3 0 0 0-3 3z"/>`, 14)
export const PLAN_ICON_SVG = SVG(`<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`, 14)
export const COMPLETION_SVG = SVG_FILL(`<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>`, 14)
export const APPROVAL_SVG = SVG(`<path d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>`, 14)
export const CHECKPOINT_SVG = SVG(`<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>`, 14)
export const FILE_READ_ICON_SVG = SVG(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`, 14)
export const FILE_EDIT_ICON_SVG = SVG(`<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`, 14)

// ─── Subagent Domain Icons (replaces emoji in subagent-panel.ts) ───
export const DOMAIN_FRONTEND_SVG = SVG(`<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>`, 14)
export const DOMAIN_BACKEND_SVG = SVG(`<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>`, 14)
export const DOMAIN_DATABASE_SVG = SVG(`<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>`, 14)
export const DOMAIN_API_SVG = SVG(`<path d="M8 9l-4 3 4 3"/><path d="M16 9l4 3-4 3"/><line x1="14" y1="6" x2="10" y2="18"/>`, 14)
export const DOMAIN_SHARED_SVG = SVG(`<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>`, 14)

// ─── Per-Tool-Name Icons (extends the 4-class system to actual tool names) ───
export const TOOL_GREP_SVG = SVG(`<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>`, 14)
export const TOOL_GLOB_SVG = SVG(`<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`, 14)
export const TOOL_LS_SVG = SVG(`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`, 14)
export const TOOL_TASK_SVG = SVG(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/><path d="M19 8v6"/>`, 14)
export const TOOL_TODOWRITE_SVG = SVG(`<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`, 14)
export const TOOL_WEBSEARCH_SVG = SVG(`<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`, 14)
export const TOOL_WEBFETCH_SVG = SVG(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`, 14)
export const TOOL_PLAN_SVG = SVG(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/><circle cx="6" cy="8" r=".5" fill="currentColor"/><circle cx="18" cy="8" r=".5" fill="currentColor"/>`, 14)
export const TOOL_QUESTION_SVG = SVG(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/>`, 14)
export const TOOL_SKILL_SVG = SVG(`<path d="M12 3l-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5z"/><path d="M5 16l-1 2.5L1.5 20l2.5 1L5 23.5l1-2.5 2.5-1-2.5-1z"/><path d="M19 14l-.5 1.5L17 16l1.5.5L19 18l.5-1.5L21 16l-1.5-.5z"/>`, 14)
export const TOOL_LSP_SVG = SVG(`<path d="M12 2L4 7v10l8 5 8-5V7l-8-5z"/><path d="M12 22V12"/><path d="M4 7l8 5 8-5"/>`, 14)
export const TOOL_GIT_SVG = SVG(`<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><line x1="6" y1="8" x2="6" y2="16"/><path d="M18 8a4 4 0 0 0-4 4"/>`, 14)
export const TOOL_MEMORY_SVG = SVG(`<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>`, 14)
export const TOOL_CHECKPOINT_SVG = SVG(`<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>`, 14)
export const TOOL_FALLBACK_SVG = SVG(`<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`, 14)
export const TOOL_EDIT_SVG = SVG(`<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`, 14)
export const TOOL_BASH_SVG = SVG(`<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/><line x1="2" y1="3" x2="22" y2="3"/>`, 14)

// ─── Tool State Overlays (Sprint 4: visual indicator for current state) ───
export const STATE_PENDING_SVG = SVG(`<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>`, 12)
export const STATE_RUNNING_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="premium-spinner" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-dasharray="28" stroke-dashoffset="28"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle></svg>`
export const STATE_SUCCESS_SVG = SVG_FILL(`<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>`, 12)
export const STATE_FAILED_SVG = SVG_FILL(`<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>`, 12)
export const STATE_CANCELLED_SVG = SVG(`<circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>`, 12)
export const STATE_TIMEOUT_SVG = SVG(`<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/><line x1="3" y1="3" x2="21" y2="21"/>`, 12)

// ─── Per-tool-name resolver (Sprint 4) ───
import type { ToolCallClass } from "./types"
export type ToolName = string

const TOOL_NAME_ICONS: Readonly<Record<string, string>> = Object.freeze({
  grep: TOOL_GREP_SVG,
  glob: TOOL_GLOB_SVG,
  ls: TOOL_LS_SVG,
  list: TOOL_LS_SVG,
  task: TOOL_TASK_SVG,
  todowrite: TOOL_TODOWRITE_SVG,
  todo_write: TOOL_TODOWRITE_SVG,
  websearch: TOOL_WEBSEARCH_SVG,
  web_search: TOOL_WEBSEARCH_SVG,
  webfetch: TOOL_WEBFETCH_SVG,
  web_fetch: TOOL_WEBFETCH_SVG,
  plan: TOOL_PLAN_SVG,
  question: TOOL_QUESTION_SVG,
  skill: TOOL_SKILL_SVG,
  lsp: TOOL_LSP_SVG,
  git_commit: TOOL_GIT_SVG,
  git_diff: TOOL_GIT_SVG,
  git_log: TOOL_GIT_SVG,
  git_status: TOOL_GIT_SVG,
  memory: TOOL_MEMORY_SVG,
  checkpoint: TOOL_CHECKPOINT_SVG,
  edit: TOOL_EDIT_SVG,
  patch: TOOL_EDIT_SVG,
  apply_patch: TOOL_EDIT_SVG,
  multiedit: TOOL_EDIT_SVG,
  bash: TOOL_BASH_SVG,
  shell: TOOL_BASH_SVG,
  command: TOOL_BASH_SVG,
  terminal: TOOL_BASH_SVG,
  run_command: TOOL_BASH_SVG,
})

export function toolIconFor(toolName: string, toolClass: ToolCallClass | string | null | undefined): string {
  if (toolName) {
    const key = toolName.toLowerCase()
    if (TOOL_NAME_ICONS[key]) return TOOL_NAME_ICONS[key]!
    const normalized = key.replace(/[^a-z0-9]/g, "_")
    if (TOOL_NAME_ICONS[normalized]) return TOOL_NAME_ICONS[normalized]!
  }
  switch (toolClass) {
    case "write": return TOOL_WRITE_SVG
    case "exec": return TOOL_EXEC_SVG
    case "meta": return TOOL_META_SVG
    case "read":
    default: return TOOL_READ_SVG
  }
}

export function toolStateOverlayFor(state: string): string | null {
  switch (state) {
    case "pending": return STATE_PENDING_SVG
    case "running": return STATE_RUNNING_SVG
    case "completed":
    case "succeeded": return STATE_SUCCESS_SVG
    case "failed":
    case "error": return STATE_FAILED_SVG
    case "cancelled": return STATE_CANCELLED_SVG
    case "timed_out":
    case "timeout": return STATE_TIMEOUT_SVG
    default: return null
  }
}

// ─── Document Type Icons (for attachment chips) ───
export const DOC_TEXT_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8 13" x2="16 13"/><line x1="8 17" x2="16 17"/>`, 14)
export const DOC_MARKDOWN_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 18l2-3 2 3"/><path d="M14 18l2-3 2 3"/>`, 14)
export const DOC_CSV_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 14h8"/><path d="M8 17h8"/><path d="M8 11h8"/>`, 14)
export const DOC_PDF_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 18v-6h2a2 2 0 0 1 0 4H8"/>`, 14)
export const DOC_JSON_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13a2 2 0 0 0-2 2v1a2 2 0 0 1-2 2 2 2 0 0 1 2 2v1a2 2 0 0 0 2 2"/><path d="M15 13a2 2 0 0 1 2 2v1a2 2 0 0 0 2 2 2 2 0 0 0-2 2v1a2 2 0 0 1-2 2"/>`, 14)
export const DOC_XML_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M12 17h4"/><path d="M14 13h2"/>`, 14)
export const DOC_YAML_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13l2 3 2-3"/><path d="M12 17h4"/>`, 14)
export const DOC_GENERIC_SVG = SVG(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`, 14)
