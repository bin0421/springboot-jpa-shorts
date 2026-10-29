// Builds index.html from template.html: lays scenes end to end from the
// narration lengths and turns edge-tts subtitles into absolute caption cues.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PAD = 0.6; // breath after each narration line
const MAX_CHARS = 26; // split longer cues at commas
const script = require("./narration/script.json");

const ffprobe = process.env.FFPROBE || "ffprobe";
const dur = (f) =>
  parseFloat(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const secs = (t) => {
  const [h, m, s] = t.replace(",", ".").split(":");
  return +h * 3600 + +m * 60 + +s;
};

function parseSrt(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const [a, b] = lines[1].split(" --> ");
      return { t0: secs(a), t1: secs(b), text: lines.slice(2).join(" ") };
    });
}

// Long cues are split at commas, time shared by character count.
function splitCue(c) {
  if (c.text.length <= MAX_CHARS) return [c];
  const parts = c.text.split(/(?<=,)\s+/);
  if (parts.length < 2) return [c];
  const total = parts.reduce((n, p) => n + p.length, 0);
  let t = c.t0;
  return parts.map((p) => {
    const d = ((c.t1 - c.t0) * p.length) / total;
    const out = { t0: t, t1: t + d, text: p };
    t += d;
    return out;
  });
}

let t = 0;
const scenes = {};
const cues = [];
const audio = [];
for (const s of script) {
  const mp3 = `assets/vo/${s.id}.mp3`;
  const d = dur(path.join(__dirname, mp3));
  scenes[s.id] = { start: +t.toFixed(3), dur: +(d + PAD).toFixed(3) };
  parseSrt(path.join(__dirname, `assets/vo/${s.id}.srt`))
    .flatMap(splitCue)
    .forEach((c, i) =>
      cues.push({ scene: s.id, i, t0: +(t + c.t0).toFixed(3), t1: +(t + c.t1).toFixed(3), text: c.text })
    );
  audio.push(
    `<audio id="vo-${s.id}" src="${mp3}" data-start="${t.toFixed(3)}" data-duration="${d.toFixed(3)}" data-track-index="1"></audio>`
  );
  t += d + PAD;
}
const total = (t + 0.4).toFixed(3);

const html = fs
  .readFileSync(path.join(__dirname, "narration/template.html"), "utf8")
  .replaceAll("{{TOTAL}}", total)
  .replace("<!--{{AUDIO}}-->", audio.join("\n      "))
  .replace("/*{{DATA}}*/", `const SCENES = ${JSON.stringify(scenes)};\n      const CUES = ${JSON.stringify(cues)};`);
fs.writeFileSync(path.join(__dirname, "index.html"), html);
console.log(`index.html written: ${total}s, ${cues.length} cues`);
