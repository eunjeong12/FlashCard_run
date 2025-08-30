// generate-tts.mjs
// 구글 음성 출력 후 다운로드
import fs from "fs";
import path from "path";
import textToSpeech from "@google-cloud/text-to-speech";

// ===== 설정 =====
const OUT_DIR = path.resolve("./public/audio"); // mp3 저장 폴더
const DEFAULTS = {
  "ko-KR": { voice: "ko-KR-Neural2-C", rate: 1.0 },
  "en-US": { voice: "en-US-Neural2-C", rate: 1.0 },
};

// ===== 입력: korea1.json / english1.json 같은 "행 단위" 배열 =====
// 예:
// [
//   { "id": 278, "term": "Cruise Ship", "tts.lang": "en-US", "tts.rate": 1 },
//   { "id": 12,  "term": "사과",        "tts.lang": "ko-KR" }
// ]
const inputFiles = process.argv.slice(2);
if (inputFiles.length === 0) {
  console.error("사용법: node generate-tts.mjs english1.json korea1.json");
  process.exit(1);
}

// ===== GCP 클라이언트 =====
// 환경변수 설정 필요 (PowerShell 예):
//  $env:GOOGLE_APPLICATION_CREDENTIALS = "$PWD\\gcp-tts.json"
const client = new textToSpeech.TextToSpeechClient();

// ----- 헬퍼 -----
function readJsonArray(file) {
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [data];
}

// Windows/웹 서버에서 문제되는 문자를 치환(공백은 유지)
function sanitizeForFilename(s) {
  // \/:*?"<>| 및 제어문자 제거/치환
  return String(s)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

// 파일명: 4자리ID + '_' + 원문term(공백 유지, 특수문자 정리) + '_' + lang + '.mp3'
// 예) 0278_Cruise Ship_en-US.mp3, 0012_사과_ko-KR.mp3
function buildFilename(id, term, lang) {
  const id4 = String(Math.max(0, Number(id) || 0)).padStart(4, "0");
  const safeTerm = sanitizeForFilename(term);
  return `${id4}_${lang}.mp3`;
}

function rowToSpec(row, fallbackId) {
  const term = String(row.term ?? "").trim();
  if (!term) return null;

  const id = typeof row.id === "number" ? row.id : fallbackId;
  const lang = row["tts.lang"] ?? "ko-KR";
  const rate = Number(row["tts.rate"] ?? DEFAULTS[lang]?.rate ?? 1.0);
  const voice =
    row["tts.voice"] ?? DEFAULTS[lang]?.voice ?? `${lang}-Standard-A`;

  const file = buildFilename(id, term, lang);
  return { id, term, lang, rate, voice, file };
}

async function synthOne({ term, lang, rate, voice, file }) {
  const outPath = path.join(OUT_DIR, file);
  if (fs.existsSync(outPath)) {
    console.log(`skip (exists): ${file}`);
    return;
  }

  const [res] = await client.synthesizeSpeech({
    input: { text: term },
    voice: { languageCode: lang, name: voice },
    audioConfig: { audioEncoding: "MP3", speakingRate: rate },
  });

  fs.writeFileSync(outPath, res.audioContent, "binary");
  console.log(`saved: ${file} (${lang}, ${voice}, rate=${rate})`);
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // 모든 파일 읽고 → (term, lang, id) 기준으로 중복 방지
  const specsMap = new Map(); // key: `${id}__${lang}__${term}`
  for (const f of inputFiles) {
    const rows = readJsonArray(f);
    rows.forEach((r, i) => {
      const spec = rowToSpec(r, i + 1);
      if (!spec) return;
      const key = `${spec.id}__${spec.lang}__${spec.term}`;
      if (!specsMap.has(key)) specsMap.set(key, spec);
    });
  }

  // 순차 생성 (요청 과속 방지)
  for (const spec of specsMap.values()) {
    try {
      await synthOne(spec);
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      console.error("fail:", spec.term, spec.lang, e?.message || e);
    }
  }

  console.log("✅ done. files in:", OUT_DIR);
})();
