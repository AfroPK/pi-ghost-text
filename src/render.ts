/** Overlay ghost text on the focused editor's rendered cursor line. */
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { fitSuggestionToWidth } from "./normalize.ts";

const SGR_RUN = /^(?:\x1b\[[0-9;:]*m)*/;
// pi-tui >= 1.6 wraps the cursor cell in zero-width APC markers
// (FAKE_CURSOR_START/END in pi-tui, not re-exported from its public entry).
const FAKE_CURSOR_START = "\x1b_pi:fc\x07";
const FAKE_CURSOR_END = "\x1b_pi:/fc\x07";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** True when the cursor sits after the last character of the last logical line. */
export function isCursorAtEnd(lines: readonly string[], cursor: { line: number; col: number }): boolean {
	return cursor.line === lines.length - 1 && cursor.col >= (lines[lines.length - 1] ?? "").length;
}

export function renderGhostText(
	lines: readonly string[],
	width: number,
	ghost: string | null,
	cursorAtEnd: boolean,
	dim: (text: string) => string,
): string[] {
	if (!ghost || !cursorAtEnd) return [...lines];

	// The focused editor emits CURSOR_MARKER right before the fake cursor.
	// Inserting the ghost after the cursor keeps this independent of the
	// editor's internal wrap/scroll layout.
	const idx = lines.findIndex((l) => l.includes(CURSOR_MARKER));
	if (idx === -1) return [...lines];

	const line = lines[idx]!;
	let pos = line.indexOf(CURSOR_MARKER) + CURSOR_MARKER.length;

	// Newer pi-tui emits CURSOR_MARKER + FAKE_CURSOR_START + cell + FAKE_CURSOR_END;
	// older versions emitted the cell bare. Handle both.
	const hasFakeCursor = line.startsWith(FAKE_CURSOR_START, pos);
	if (hasFakeCursor) pos += FAKE_CURSOR_START.length;

	// Skip the cursor cell as styling + one grapheme + styling, so any SGR
	// reset spelling the theme uses to close the inverse-video cursor works.
	pos += SGR_RUN.exec(line.slice(pos))![0].length;
	const glyph = graphemes.segment(line.slice(pos))[Symbol.iterator]().next().value?.segment;
	if (!glyph) return [...lines];
	pos += glyph.length;
	pos += SGR_RUN.exec(line.slice(pos))![0].length;
	if (hasFakeCursor) {
		if (!line.startsWith(FAKE_CURSOR_END, pos)) return [...lines];
		pos += FAKE_CURSOR_END.length;
		pos += SGR_RUN.exec(line.slice(pos))![0].length;
	}

	// Only overwrite plain trailing padding; anything else after the cursor
	// (a border, styled content) means the layout isn't what we expect.
	const pad = /^((?:\x1b\[[0-9;:]*m)*)( *)((?:\x1b\[[0-9;:]*m)*)$/.exec(line.slice(pos));
	if (!pad) return [...lines];
	const [, lead, spaces, trail] = pad;

	const room = Math.min(spaces!.length, width - visibleWidth(line.slice(0, pos))) - 1;
	if (room < 6) return [...lines];

	const shown = fitSuggestionToWidth(ghost.replace(/\s+/g, " "), room, visibleWidth);
	const shownWidth = visibleWidth(shown);
	// pi >= 1.6 treats render output as read-only (containers cache arrays), so
	// copy instead of mutating the caller's lines.
	const out = [...lines];
	out[idx] = line.slice(0, pos) + dim(shown) + lead + " ".repeat(spaces!.length - shownWidth) + trail;
	return out;
}
