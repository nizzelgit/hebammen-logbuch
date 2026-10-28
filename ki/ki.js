// Lokale KI: Parakeet (Sprache → Text) und ein kleines Sprachmodell (Text → Felder).
// Alles läuft im Browser auf dem Gerät; nach dem ersten Download auch offline.
import { fromUrls } from "parakeet.js";
import { CreateMLCEngine } from "@mlc-ai/web-llm";

const PARAKEET = "https://huggingface.co/efederici/parakeet-tdt-0.6b-v3-onnx-int4/resolve/main";
const PARAKEET_FILES = { encoderUrl: "encoder-model.int4.onnx", decoderUrl: "decoder_joint-model.int8.onnx", tokenizerUrl: "vocab.txt" };
const CACHE = "hlb-sprachmodell-v1";

export const LLM_MODELS = {
  "Qwen2.5-1.5B-Instruct": { label: "Qwen 2.5 1.5B (empfohlen, ca. 1 GB)" },
  "Qwen2.5-3B-Instruct": { label: "Qwen 2.5 3B (genauer, ca. 2 GB, langsamer)" },
  "Llama-3.2-1B-Instruct": { label: "Llama 3.2 1B (am schnellsten, ca. 0,7 GB)" },
};

let speech = null, speechBackend = "", engine = null, engineId = "";

export async function deviceInfo() {
  if (!("gpu" in navigator)) return { webgpu: false, f16: false };
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return { webgpu: false, f16: false };
    return { webgpu: true, f16: a.features.has("shader-f16") };
  } catch (e) { return { webgpu: false, f16: false }; }
}

// Datei einmal laden und im Cache des Browsers ablegen
async function cachedUrl(url, onBytes) {
  const cache = await caches.open(CACHE);
  let res = await cache.match(url);
  if (!res) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
    const total = +r.headers.get("content-length") || 0, reader = r.body.getReader(), chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.length;
      onBytes && onBytes(loaded, total);
    }
    const blob = new Blob(chunks);
    try { await cache.put(url, new Response(blob)); } catch (e) { console.warn("Modell nicht im Cache gespeichert", e); }
    return URL.createObjectURL(blob);
  }
  return URL.createObjectURL(await res.blob());
}

export async function speechCached() {
  const cache = await caches.open(CACHE);
  return !!(await cache.match(`${PARAKEET}/${PARAKEET_FILES.encoderUrl}`));
}

export async function loadSpeech(onProgress = () => {}) {
  if (speech) return speechBackend;
  const urls = {}, names = Object.entries(PARAKEET_FILES);
  for (let i = 0; i < names.length; i++) {
    const [key, file] = names[i];
    urls[key] = await cachedUrl(`${PARAKEET}/${file}`, (l, t) => onProgress(`Spracherkennung laden: ${file}`, t ? l / t : 0));
  }
  onProgress("Spracherkennung starten", 1);
  const { webgpu } = await deviceInfo();
  for (const backend of webgpu ? ["webgpu", "wasm"] : ["wasm"]) {
    try {
      speech = await fromUrls({ ...urls, preprocessorBackend: "js", backend, wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/" });
      speechBackend = backend;
      return backend;
    } catch (e) { console.warn("Parakeet", backend, e); }
  }
  throw new Error("Spracherkennung konnte nicht gestartet werden.");
}

// Aufnahme (Blob) → 16 kHz Mono → Text
export async function transcribe(blob) {
  if (!speech) throw new Error("Spracherkennung ist nicht geladen.");
  const ctx = new AudioContext({ sampleRate: 16000 });
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const pcm = buf.numberOfChannels === 1 ? buf.getChannelData(0) : mixDown(buf);
  ctx.close();
  const res = await speech.transcribe(pcm, 16000);
  return (res.utterance_text || res.text || "").trim();
}
function mixDown(buf) {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}

export async function loadLLM(name, onProgress = () => {}) {
  const { f16 } = await deviceInfo();
  const id = `${name}-${f16 ? "q4f16_1" : "q4f32_1"}-MLC`;
  if (engine && engineId === id) return id;
  if (engine) { await engine.unload(); engine = null; }
  engine = await CreateMLCEngine(id, { initProgressCallback: r => onProgress(r.text, r.progress) });
  engineId = id;
  return id;
}

const SCHEMA = {
  type: "object",
  properties: {
    frau: { type: "string" },
    datum: { type: "string" },
    beginn: { type: "string" },
    ende: { type: "string" },
    dauer_minuten: { type: "integer" },
    bereich: { type: "string", enum: ["schwangerschaft", "vorsorge", "aufklaerung", "stillvorbereitung", "wochenbett", "stillschwierigkeiten", "unklar"] },
    art: { type: "integer", enum: [1, 2, 3, 4] },
    km: { type: "number" },
    frauen_auf_route: { type: "integer" },
    material: { type: "array", items: { type: "string", enum: ["60300", "60400", "60500", "60700", "61100", "61400", "61500", "61600", "61700"] } },
  },
  required: ["frau", "datum", "beginn", "ende", "dauer_minuten", "bereich", "art", "km", "frauen_auf_route", "material"],
};

function systemPrompt(ctx) {
  return `Du wandelst kurze Diktate einer Hebamme in JSON um. Erfinde nichts. Fehlt eine Angabe, nimm "" bzw. 0.
Heute ist ${ctx.weekday}, ${ctx.today}. Gestern war ${ctx.yesterday}.
Betreute Frauen (exakt so schreiben): ${ctx.names.join(", ") || "keine"}.
Felder:
- frau: Name aus der Liste
- datum: JJJJ-MM-TT, ohne Angabe heute
- beginn, ende: HH:MM im 24-Stunden-Format. "halb zehn" = 09:30, "viertel nach zwei" am Nachmittag = 14:15, "kurz nach zehn" = 10:05
- dauer_minuten: nur wenn eine Dauer statt Ende genannt wird, sonst 0
- bereich: schwangerschaft (Hilfe, Beratung, Beschwerden in der Schwangerschaft), vorsorge (Vorsorgeuntersuchung), aufklaerung (Gespräch zum Geburtsort), stillvorbereitung, wochenbett (Nachsorge, Hausbesuch, Wochenbett), stillschwierigkeiten (Still- oder Ernährungsprobleme ab der 13. Woche)
- art: 1 Hausbesuch bei der Frau, 2 bei der Hebamme/Praxis, 3 Video, 4 Telefon
- km: gefahrene Gesamtstrecke, frauen_auf_route: Anzahl Frauen auf dieser Tour (sonst 1)
- material: 60300 Blut/Urin/Abstrich bei der Frau, 60400 Zuckertest/GDM, 60500 CTG, 60700 Blasensprung abklären, 61100 Pulsoxymetrie, 61400 Neugeborenen-Screening, 61500 Blut beim Kind, 61600 Fäden Dammnaht, 61700 Fäden/Klammern Kaiserschnitt`;
}

const EXAMPLE_IN = "Lena, Nachsorge, halb zehn bis zehn nach zehn, 12 Kilometer, Fersenblut abgenommen";

export async function extract(text, ctx) {
  if (!engine) throw new Error("Sprachmodell ist nicht geladen.");
  const exampleOut = { frau: ctx.names[0] || "Lena", datum: ctx.today, beginn: "09:30", ende: "10:10", dauer_minuten: 0, bereich: "wochenbett", art: 1, km: 12, frauen_auf_route: 1, material: ["61500"] };
  const t0 = performance.now();
  const reply = await engine.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt(ctx) },
      { role: "user", content: EXAMPLE_IN.replace("Lena", exampleOut.frau) },
      { role: "assistant", content: JSON.stringify(exampleOut) },
      { role: "user", content: text },
    ],
    temperature: 0,
    max_tokens: 220,
    response_format: { type: "json_object", schema: JSON.stringify(SCHEMA) },
  });
  const raw = reply.choices[0].message.content;
  return { data: JSON.parse(raw), ms: Math.round(performance.now() - t0) };
}

export const status = () => ({ speech: !!speech, speechBackend, llm: engineId });
