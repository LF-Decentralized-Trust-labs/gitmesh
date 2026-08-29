/**
 * Parses JSONC - JSON with `//` and block comments and trailing commas, the
 * dialect VS Code writes `settings.json` in and OpenCode accepts for
 * `opencode.jsonc`. Returns `undefined` on any failure so callers stay
 * total; plain JSON parses unchanged.
 */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(stripJsonc(text));
  } catch {
    return undefined;
  }
}

/**
 * Turns JSONC into JSON `JSON.parse` accepts: `//` and block comments are
 * dropped and trailing commas removed. String literals are copied through
 * untouched, so no comment marker or comma inside a value is mistaken for
 * syntax.
 */
function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      if (ch === "}" || ch === "]") {
        out = dropTrailingComma(out);
      }
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * Drops the comma dangling at the end of `out`, if any. Only structural
 * commas can be last: a comma inside a string is followed by its closing
 * quote, which is copied through with it.
 */
function dropTrailingComma(out: string): string {
  const trimmed = out.trimEnd();
  return trimmed.endsWith(",") ? trimmed.slice(0, -1) : out;
}

/** Index one past the JSON string literal starting at `start`. */
function endOfString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
    } else if (text[i] === '"') {
      return i + 1;
    }
  }
  return text.length;
}
