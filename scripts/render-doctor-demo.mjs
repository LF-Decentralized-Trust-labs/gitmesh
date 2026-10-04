#!/usr/bin/env node
/**
 * render-doctor-demo.mjs
 *
 * Renders the README's terminal demo from a real `gitmesh doctor` run over
 * the sample fixture (cli/fixtures/doctor/sample/input-repo):
 *
 *   public/doctor-demo.gif  the recording at the top of the README
 *   public/doctor-demo.svg  its last frame, which the README shows instead
 *                           when the reader's system asks for reduced motion
 *
 * Re-run it whenever doctor's terminal output changes. Needs a checkout that
 * has run `pnpm install`, plus git and an ffmpeg built with librsvg (the
 * Debian and Ubuntu packages are). Maintainer tool: no package or CI job
 * runs it.
 *
 *   node scripts/render-doctor-demo.mjs
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "cli/fixtures/doctor/sample/input-repo");
const EXPECTED = join(ROOT, "cli/fixtures/doctor/sample/expected/doctor.json");
const GIF = join(ROOT, "public/doctor-demo.gif");
const SVG = join(ROOT, "public/doctor-demo.svg");

const COMMAND = "npx gitmesh-cli@next doctor";
// Doctor does not wrap long lines. The recording breaks them after the last
// space that fits in COLS columns, so no path or word is split, and 92
// columns keep the image narrow enough to show unscaled in a GitHub README.
const COLS = 92;
const FONT =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";
const FONT_SIZE = 14;
const CHAR_W = FONT_SIZE * 0.6; // advance of SF Mono, Menlo and DejaVu Sans Mono
const ROW_H = 20;
const PAD = 20;
const TOP = 52; // baseline of the first row, below the title bar
const SCALE = 2; // GIF pixels per SVG unit, so text stays sharp on HiDPI screens

const COLORS = {
  bg: "#0d1117",
  fg: "#e6edf3",
  dim: "#8b949e",
  title: "#6e7681",
};
const SGR_FG = { 31: "#ff7b72", 33: "#e3b341", 36: "#79c0ff" };

function must(cmd, args, options = {}) {
  const run = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (run.error) throw new Error(`${cmd}: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${run.stderr}`);
  return run;
}

/** Runs doctor on a throwaway copy of the fixture, colored as on a terminal. */
function runDoctor() {
  const work = mkdtempSync(join(tmpdir(), "gitmesh-demo-"));
  try {
    const repo = join(work, "my-repo");
    const home = join(work, "home");
    cpSync(FIXTURE, repo, { recursive: true });
    mkdirSync(home);
    must("git", ["init", "--quiet"], { cwd: repo });
    // An empty HOME and no CODEX_HOME keep this machine's own agent config
    // out of the inventory.
    const env = { ...process.env, FORCE_COLOR: "1", HOME: home, USERPROFILE: home };
    delete env.NO_COLOR;
    delete env.CODEX_HOME;
    const tsx = join(ROOT, "cli/node_modules/tsx/dist/cli.mjs");
    const doctor = (...args) => {
      const run = spawnSync(process.execPath, [tsx, join(ROOT, "cli/src/gitmesh.ts"), "doctor", ...args], {
        cwd: repo,
        env,
        encoding: "utf8",
      });
      if (run.error) throw run.error;
      if (run.status !== 0 && run.status !== 1) {
        throw new Error(`doctor exited ${run.status} on the sample:\n${run.stderr}`);
      }
      return run;
    };
    // The recording must show the tested report. Presence probes outside
    // HOME (org-managed Claude settings, Codex's requirements.toml) can add
    // artifacts on some machines.
    const expected = JSON.parse(readFileSync(EXPECTED, "utf8"));
    if (!isDeepStrictEqual(JSON.parse(doctor("--json").stdout), expected)) {
      throw new Error(
        "doctor --json on the sample differs from cli/fixtures/doctor/sample/expected/doctor.json; " +
          "update the golden file first, or run where no machine-level agent config exists",
      );
    }
    const run = doctor();
    return { output: run.stdout, exitCode: run.status };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Splits ANSI-colored text into rows of styled segments. */
function parseAnsi(text) {
  const style = { bold: false, dim: false, color: null };
  return text
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => {
      const row = [];
      for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
        const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
        if (!sgr) {
          if (part) row.push({ text: part, ...style });
          continue;
        }
        for (const code of (sgr[1] || "0").split(";").map(Number)) {
          if (code === 0) Object.assign(style, { bold: false, dim: false, color: null });
          else if (code === 1) style.bold = true;
          else if (code === 2) style.dim = true;
          else if (code === 22) Object.assign(style, { bold: false, dim: false });
          else if (code === 39) style.color = null;
          else if (code in SGR_FG) style.color = SGR_FG[code];
          else throw new Error(`doctor printed SGR code ${code}; add it to this script`);
        }
      }
      return row;
    });
}

const sameStyle = (a, b) => a.bold === b.bold && a.dim === b.dim && a.color === b.color;

/** Joins neighboring characters that share a style back into segments. */
function merge(chars) {
  const row = [];
  for (const char of chars) {
    const last = row.at(-1);
    if (last && sameStyle(last, char)) last.text += char.text;
    else row.push({ ...char });
  }
  return row;
}

/** Wraps one row at COLS, after the last space in the second half of the row. */
function wrap(row) {
  const chars = row.flatMap((segment) => [...segment.text].map((text) => ({ ...segment, text })));
  const rows = [];
  let start = 0;
  while (chars.length - start > COLS) {
    let end = start + COLS;
    for (let i = end - 1; i > start + COLS / 2; i--) {
      if (chars[i].text === " ") {
        end = i + 1;
        break;
      }
    }
    rows.push(merge(chars.slice(start, end)));
    start = end;
  }
  rows.push(merge(chars.slice(start)));
  return rows;
}

const prompt = (typed) => [
  { text: "$", bold: false, dim: true, color: null },
  { text: ` ${typed}`, bold: false, dim: false, color: null },
];

// Every duration is a multiple of 0.04 s: ffmpeg's concat demuxer puts the
// SVG frames on a 25 fps grid. Keys arrive at an uneven, human pace.
const KEY_DELAYS = [0.08, 0.04, 0.04];

/** The recording: type the command, print the report, then show its exit code. */
function buildFrames(reportRows, exitCode) {
  const frames = [];
  const show = (rows, cursorCol, duration) =>
    frames.push({
      rows,
      cursor: cursorCol === null ? null : { row: rows.length - 1, col: cursorCol },
      duration,
    });
  const type = (before, text) => {
    for (let i = 1; i <= text.length; i++) {
      show([...before, prompt(text.slice(0, i))], 2 + i, KEY_DELAYS[i % KEY_DELAYS.length]);
    }
  };

  show([prompt("")], 2, 1.0);
  type([], COMMAND);
  show([prompt(COMMAND)], 2 + COMMAND.length, 0.48);
  show([prompt(COMMAND), []], 0, 0.4);
  const afterReport = [prompt(COMMAND), ...reportRows];
  show([...afterReport, prompt("")], 2, 2.0);
  type(afterReport, "echo $?");
  show([...afterReport, prompt("echo $?")], 2 + "echo $?".length, 0.32);
  const end = [...afterReport, prompt("echo $?"), [{ text: String(exitCode) }], prompt("")];
  for (let blink = 0; blink < 8; blink++) {
    show(end, 2, 0.48);
    show(end, null, 0.48);
  }
  return frames;
}

const escapeXml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function tspan(segment) {
  const color = segment.dim ? COLORS.dim : segment.color;
  const attrs = `${color ? ` fill="${color}"` : ""}${segment.bold ? ' font-weight="bold"' : ""}`;
  return `<tspan${attrs}>${escapeXml(segment.text)}</tspan>`;
}

function renderSvg(frame, size, { scale = 1, label } = {}) {
  const { width, height } = size;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${FONT_SIZE}" fill="${COLORS.fg}"${label ? ` role="img" aria-label="${escapeXml(label)}"` : ""}>`,
    `  <rect width="${width}" height="${height}" fill="${COLORS.bg}"/>`,
    ...["#ff5f57", "#febc2e", "#28c840"].map(
      (fill, i) => `  <circle cx="${PAD + 4 + i * 18}" cy="18" r="5" fill="${fill}"/>`,
    ),
    `  <text x="${width / 2}" y="22" text-anchor="middle" font-size="12" fill="${COLORS.title}">my-repo</text>`,
  ];
  frame.rows.forEach((row, i) => {
    if (row.length === 0) return;
    lines.push(
      `  <text x="${PAD}" y="${TOP + i * ROW_H}" xml:space="preserve">${row.map(tspan).join("")}</text>`,
    );
  });
  if (frame.cursor) {
    const x = (PAD + frame.cursor.col * CHAR_W).toFixed(1);
    const y = TOP + frame.cursor.row * ROW_H - FONT_SIZE + 1;
    lines.push(`  <rect x="${x}" y="${y}" width="${CHAR_W}" height="${FONT_SIZE + 3}" fill="${COLORS.fg}"/>`);
  }
  lines.push("</svg>");
  return `${lines.join("\n")}\n`;
}

function encodeGif(frames, size) {
  const decoders = spawnSync("ffmpeg", ["-hide_banner", "-decoders"], { encoding: "utf8" });
  if (decoders.error || !/librsvg/.test(decoders.stdout)) {
    throw new Error("needs ffmpeg built with librsvg (ffmpeg -decoders lists it)");
  }
  const dir = mkdtempSync(join(tmpdir(), "gitmesh-demo-frames-"));
  try {
    // Identical frames (cursor blinks) are written once and listed again.
    const names = new Map();
    const fileFor = (frame) => {
      const svg = renderSvg(frame, size, { scale: SCALE });
      if (!names.has(svg)) {
        const name = `${String(names.size).padStart(3, "0")}.svg`;
        writeFileSync(join(dir, name), svg);
        names.set(svg, name);
      }
      return names.get(svg);
    };
    const list = ["ffconcat version 1.0"];
    for (const frame of frames) list.push(`file ${fileFor(frame)}`, `duration ${frame.duration}`);
    // concat only honors a duration that another entry follows.
    list.push(`file ${fileFor(frames.at(-1))}`);
    writeFileSync(join(dir, "frames.ffconcat"), `${list.join("\n")}\n`);

    // The final screen with its cursor carries every color the recording uses.
    const palette = join(dir, "palette.png");
    const paletteSource = join(dir, fileFor(frames.findLast((frame) => frame.cursor)));
    must("ffmpeg", ["-v", "error", "-i", paletteSource, "-vf", "palettegen=reserve_transparent=0", palette]);
    must("ffmpeg", [
      ...["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "frames.ffconcat")],
      ...["-i", palette, "-lavfi", "paletteuse=dither=none", "-loop", "0", GIF],
    ]);
    return names.size;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const { output, exitCode } = runDoctor();
  const reportRows = parseAnsi(output).flatMap(wrap);
  const frames = buildFrames(reportRows, exitCode);
  const finalRows = frames.at(-1).rows;
  const size = {
    width: Math.ceil(2 * PAD + COLS * CHAR_W),
    height: TOP + (finalRows.length - 1) * ROW_H + 20,
  };
  const distinctFrames = encodeGif(frames, size);
  writeFileSync(
    SVG,
    renderSvg({ rows: finalRows, cursor: null }, size, {
      label: `Terminal session: ${COMMAND} audits a sample repository, then echo $? prints its exit code`,
    }),
  );
  const seconds = frames.reduce((total, frame) => total + frame.duration, 0);
  console.log(
    `wrote public/doctor-demo.gif (${size.width * SCALE}x${size.height * SCALE}, ${distinctFrames} distinct frames, ${seconds.toFixed(1)}s) and public/doctor-demo.svg; the README shows them ${size.width}px wide`,
  );
}

try {
  main();
} catch (err) {
  console.error(`render-doctor-demo: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
