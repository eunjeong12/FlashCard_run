import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/* =========================================================================
   타입 정의 (Card/Folder, 외부 JSON 한 행(FlatRow))
   ========================================================================= */
type Card = {
  id: number;
  term: string;
  description?: string;
  imageUrl?: string;
  tts?: {
    lang?: "ko-KR" | "en-US";
    rate?: number;
  };
};

type Folder = {
  id: number;
  name: string;
  cards: Card[];
};

type FlatRow = {
  folder: string;
  id?: number;
  term: string;
  description?: string;
  imageUrl?: string;
  ["tts.lang"]?: "ko-KR" | "en-US";
  ["tts.rate"]?: number;
};

/* =========================================================================
   샘플 폴더 (폴백)
   ========================================================================= */
const SAMPLE_FOLDERS: Folder[] = [
  {
    id: 100,
    name: "샘플 (한글)",
    cards: [
      {
        id: 1,
        term: "사과",
        description: "",
        imageUrl:
          "https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?q=80&w=800&auto=format&fit=crop",
        tts: { lang: "ko-KR" },
      },
      {
        id: 2,
        term: "바나나",
        description: "",
        imageUrl:
          "https://images.unsplash.com/photo-1571772805064-207c8435df79?q=80&w=800&auto=format&fit=crop",
        tts: { lang: "ko-KR" },
      },
    ],
  },
];

/* =========================================================================
   유틸: 이미지 URL 공백 보정
   ========================================================================= */
function normalizeImageUrl(url?: string) {
  if (!url) return url;
  try {
    return url.replace(/ /g, "%20");
  } catch {
    return url;
  }
}

/* =========================================================================
   rows(FlatRow[]) → Folder[] 변환기
   ========================================================================= */
function groupRowsToFolders(
  rows: FlatRow[],
  opts: {
    appendLabel?: string;
    defaultLang?: "ko-KR" | "en-US";
    folderIdBase: number;
  },
): Folder[] {
  const map = new Map<string, Card[]>();

  rows.forEach((row, i) => {
    const folderNameRaw = row.folder?.trim() || "기타";
    const folderName = opts.appendLabel
      ? `${folderNameRaw} ${opts.appendLabel}`
      : folderNameRaw;

    const list = map.get(folderName) ?? [];

    const id = typeof row.id === "number" ? row.id : i + 1;
    const ttsLang = row["tts.lang"] ?? opts.defaultLang;
    const ttsRate =
      typeof row["tts.rate"] === "number" ? row["tts.rate"] : undefined;

    list.push({
      id,
      term: row.term,
      description: row.description ?? "",
      imageUrl: normalizeImageUrl(row.imageUrl),
      tts: ttsLang || ttsRate ? { lang: ttsLang, rate: ttsRate } : undefined,
    });

    map.set(folderName, list);
  });

  let seq = 0;
  const folders: Folder[] = [];
  for (const [name, cards] of map.entries()) {
    folders.push({ id: opts.folderIdBase + ++seq, name, cards });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return folders;
}

/* =========================================================================
   LocalStorage Keys
   ========================================================================= */
const LS_KEYS = {
  interval: "flashcard_interval_ms",
  rate: "flashcard_tts_rate",
  shuffle: "flashcard_shuffle",
  hide: "flashcard_hide_term",
  lastFolder: "flashcard_last_folder_id",
  folders: "flashcard_folders_v5_ro",
  repeat: "flashcard_repeat_count",
  userFolders: "flashcard_user_folders_v1", // ✅ 내가 추가한 폴더/카드 (영구 저장)
  readDesc: "flashcard_read_description", // ✅ 추가
};

/* =========================================================================
   로컬스토리지 헬퍼
   ========================================================================= */
function loadNumber(key: string, fallback: number) {
  const v = localStorage.getItem(key);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function loadBool(key: string, fallback: boolean) {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === "true";
}
function loadFolderId(): number | null {
  const v = localStorage.getItem(LS_KEYS.lastFolder);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/* =========================================================================
   🔊 오디오 파일명/URL 규칙 (개정)
   - 새 규칙: {id4자리}_{lang}.mp3  (예: 0001_ko-KR.mp3)
   ========================================================================= */
function audioFileName(card: Card) {
  const id = String(card.id).padStart(4, "0");
  const lang = card.tts?.lang ?? "ko-KR";
  return `${id}_${lang}.mp3`;
}

function audioUrlOf(card: Card) {
  // 파일명만 encodeURIComponent 처리 (폴더 경로는 그대로)
  return `/audio/${encodeURIComponent(audioFileName(card))}`;
}

/* =========================================================================
   메인 컴포넌트
   ========================================================================= */
export default function FlashcardTTSSlider() {
  /* 뷰 */
  const [view, setView] = useState<"library" | "player">("library");

  /* 폴더: LS 캐시 → 없으면 샘플 */
  const [folders, setFolders] = useState<Folder[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEYS.folders);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as Folder[];
      }
    } catch {}
    return SAMPLE_FOLDERS;
  });

  /* 마지막 폴더 */
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    loadFolderId(),
  );

  // ✅ 내 폴더(편집 가능) - localStorage 로드
  const [userFolders, setUserFolders] = useState<Folder[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEYS.userFolders);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as Folder[];
      }
    } catch {}
    return [];
  });

  const combinedFolders = useMemo(
    () => [...folders, ...userFolders],
    [folders, userFolders],
  );

  // ✅ 선택 폴더 찾기도 combined에서
  const selectedFolder = useMemo(
    () =>
      combinedFolders.find((f) => f.id === selectedFolderId) ??
      combinedFolders[0] ??
      null,
    [combinedFolders, selectedFolderId],
  );

  const cards = selectedFolder?.cards ?? [];
  // ✅ 내 폴더 변경 → 영구 저장
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEYS.userFolders, JSON.stringify(userFolders));
    } catch {}
  }, [userFolders]);

  useEffect(() => {
    setUserFolders((prev) => {
      let changed = false;
      const used = new Set<number>();
      const fixed = prev.map((f) => {
        if (!f.id || used.has(f.id)) {
          changed = true;
          const newId = Date.now() + Math.floor(Math.random() * 100000);
          used.add(newId);
          return { ...f, id: newId };
        }
        used.add(f.id);
        return f;
      });
      return changed ? fixed : prev;
    });
  }, []);

  /* ✅ 외부 JSON 로드 (public/ 하위) */
  ////////////////////////////////////
  //json 파일 추가//
  useEffect(() => {
    (async () => {
      try {
        const files = [
          {
            path: "/kaven.json",
            lang: "ko-KR" as const,
            base: 1300, // 필수(중복되면 안됨!) 폴더의 id와 같다. 카드의 id와는 상관없다.
          },
          {
            path: "/korea1.json",
            label: "(한글)" as const, // 선택사항(폴더이름 중복시 필요)
            lang: "ko-KR" as const,
            base: 1000, // 필수(중복되면 안됨!) 폴더의 id와 같다. 카드의 id와는 상관없다.
          },
          {
            path: "/korea2.json",
            label: "(한글)" as const,
            lang: "ko-KR" as const,
            base: 1100,
          },
          {
            path: "/english1.json",
            label: "(영어)" as const,
            lang: "en-US" as const,
            base: 2000,
          },
          {
            path: "/english2.json",
            label: "(영어)" as const,
            lang: "en-US" as const,
            base: 2100,
          },
          {
            path: "/book1.json",
            label: "(한글)" as const,
            lang: "ko-KR" as const,
            base: 1200,
          },
          {
            path: "/business.json",

            lang: "ko-KR" as const,
            base: 3000,
          },
        ];

        const settled = await Promise.allSettled(
          files.map((f) => fetch(f.path, { cache: "no-cache" })),
        );

        const nextFolders: Folder[] = [];

        for (let i = 0; i < settled.length; i++) {
          const meta = files[i];
          const res = settled[i];

          if (res.status === "fulfilled" && res.value.ok) {
            try {
              const json = (await res.value.json()) as FlatRow[] | FlatRow;
              const rows = Array.isArray(json) ? json : [json];
              if (rows.length) {
                nextFolders.push(
                  ...groupRowsToFolders(rows, {
                    appendLabel: meta.label,
                    defaultLang: meta.lang,
                    folderIdBase: meta.base,
                  }),
                );
              }
            } catch (e) {
              console.error(`[JSON 파싱 실패] ${meta.path}`, e);
            }
          } else {
            const reason =
              res.status === "rejected"
                ? res.reason
                : `${res.value.status} ${res.value.statusText}`;
            console.warn(`[불러오기 실패] ${meta.path}`, reason);
          }
        }

        if (nextFolders.length) {
          setFolders(nextFolders);
          if (loadFolderId() == null) setSelectedFolderId(nextFolders[0].id);
        } else {
          setFolders((prev) => (prev.length ? prev : SAMPLE_FOLDERS));
        }
      } catch (err) {
        console.error("fetch 전체 실패", err);
        setFolders((prev) => (prev.length ? prev : SAMPLE_FOLDERS));
      }
    })();
  }, []);

  /* 플레이어 상태 */
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [shuffle, setShuffle] = useState(loadBool(LS_KEYS.shuffle, false));
  const [hideTerm, setHideTerm] = useState(loadBool(LS_KEYS.hide, false));
  const [intervalMs, setIntervalMs] = useState(
    loadNumber(LS_KEYS.interval, 4000),
  );
  const [ttsRate, setTtsRate] = useState(loadNumber(LS_KEYS.rate, 1.0));

  // ✅ 반복 재생 상태
  const [repeatCount, setRepeatCount] = useState(
    Math.max(1, Math.min(5, loadNumber(LS_KEYS.repeat, 1))),
  );
  const repeatRemainRef = useRef<number>(repeatCount);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.repeat, String(repeatCount));
  }, [repeatCount]);

  // 🔊 오디오 재생
  const [preferAudio, setPreferAudio] = useState(true);
  const [readDescription, setReadDescription] = useState(
    // ✅ 추가
    loadBool(LS_KEYS.readDesc, false),
  );
  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    localStorage.setItem(LS_KEYS.readDesc, String(readDescription));
  }, [readDescription]);

  // refs
  const currentUtterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const lastSpokenIdRef = useRef<number | null>(null);
  const advanceTimerRef = useRef<number | null>(null);

  // 셔플 인덱스
  const orderRef = useRef<number[]>([]);
  useEffect(() => {
    const base = cards.map((_, i) => i);
    if (shuffle) {
      const arr = [...base];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      orderRef.current = arr;
    } else {
      orderRef.current = base;
    }
  }, [cards, shuffle]);
  const logicalIndexToReal = (i: number) => orderRef.current[i] ?? i;

  // 단어 숨김 임시 공개
  const [tempRevealId, setTempRevealId] = useState<number | null>(null);
  useEffect(() => {
    setTempRevealId(null);
  }, [index, selectedFolderId]);

  // 현재 카드 진입 시 반복 카운터 초기화
  useEffect(() => {
    repeatRemainRef.current = repeatCount;
  }, [index, selectedFolderId, repeatCount]);

  // 공통: 반복/다음카드 결정
  function advanceOrRepeat(onRepeat: () => void, onDone: () => void) {
    if (repeatRemainRef.current > 1) {
      repeatRemainRef.current -= 1;
      onRepeat();
    } else {
      onDone();
    }
  }
  function speakDescriptionThenNext(card: Card) {
    const text = (card.description ?? "").trim();
    if (!text) {
      if (isPlaying) setIndex((prev) => (prev + 1) % cards.length);
      return;
    }

    // 설명은 항상 한국어로 읽기
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR"; // ✅ 강제 고정
    u.rate = card.tts?.rate ?? ttsRate ?? 1.0;

    // (선택) 한국어 보이스가 있으면 지정
    try {
      const voices = window.speechSynthesis.getVoices?.() || [];
      const ko = voices.find((v) => v.lang?.toLowerCase().startsWith("ko"));
      if (ko) u.voice = ko;
    } catch {}

    u.onend = () => {
      if (isPlaying) setIndex((prev) => (prev + 1) % cards.length);
    };
    u.onerror = () => {
      if (isPlaying) setIndex((prev) => (prev + 1) % cards.length);
    };

    try {
      window.speechSynthesis.cancel();
    } catch {}
    window.speechSynthesis.speak(u);
  }

  // ===== 오디오 1회 재생 + 끝나면 onEnd 호출 (핸들러를 play 이전에 바인딩) =====
  function playAudioOnce(card: Card, onEnd: () => void) {
    const url = audioUrlOf(card);
    let a = audioCache.current.get(url);
    if (!a) {
      a = new Audio(url);
      a.preload = "auto";
      audioCache.current.set(url, a);
    }

    // 기존 핸들러 초기화 후 새로 바인딩 (중복, 유실 방지)
    a.onended = null;
    a.onerror = null;
    a.onpause = null;

    a.loop = false;
    a.currentTime = 0;

    // ✅ play 이전에 onended 바인딩
    a.onended = () => onEnd();
    a.onerror = () => {
      console.warn("audio load/play error:", url);
      onEnd(); // 에러도 같은 플로우로 흘림 (필요시 TTS 폴백)
    };

    a.play().catch(() => onEnd());
  }

  // ===== 반복 횟수(repeatRemainRef)에 맞춰 mp3 재생하고, 다 끝나면 다음 카드 =====
  function playAudioWithRepeat(card: Card) {
    playAudioOnce(card, () => {
      advanceOrRepeat(
        () => {
          playAudioWithRepeat(card);
        }, // onRepeat
        () => {
          // onDone
          if (readDescription) speakDescriptionThenNext(card);
          else if (isPlaying) setIndex((prev) => (prev + 1) % cards.length);
        },
      );
    });
  }

  // /* -------- TTS 공통 헬퍼 (세션/반복 보장) -------- */
  // function speakWithTTS(card: Card, session: number) {
  //   window.speechSynthesis.cancel();

  //   const speakOnce = () => {
  //     const u = new SpeechSynthesisUtterance(card.term);
  //     u.rate = card.tts?.rate ?? ttsRate;
  //     if (card.tts?.lang) u.lang = card.tts.lang;

  //     u.onend = () => {
  //       if (session !== playSessionIdRef.current) return; // 세션 체크
  //       advanceOrRepeat(
  //         () => speakOnce(), // 🔁 반복
  //         () => {
  //           // ✅ 반복 종료 후
  //           if (readDescription) speakDescriptionThenNext(card);
  //           else if (isPlaying) setIndex((p) => (p + 1) % cards.length);
  //         },
  //       );
  //     };

  //     window.speechSynthesis.speak(u);
  //   };

  //   speakOnce();
  // }

  /* -------- mp3 있으면 mp3, 없으면 TTS -------- */
  async function playRecordedOrTTS(card: Card) {
    if (!isUnlocked) return;

    // 남아있는 타이머 정리
    if (advanceTimerRef.current) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }

    // mp3 우선
    if (preferAudio) {
      try {
        window.speechSynthesis.cancel(); // TTS 중지
        playAudioWithRepeat(card); // ✅ 반복 포함 mp3 재생 시작
        return;
      } catch {
        // 실패 시 아래 TTS 폴백
      }
    }

    // --- TTS 폴백 (반복 포함) ---
    window.speechSynthesis.cancel();

    // 1회 TTS 헬퍼
    function speakOnce(onEnd: () => void) {
      const u = new SpeechSynthesisUtterance(card.term);
      u.rate = card.tts?.rate ?? ttsRate;
      if (card.tts?.lang) u.lang = card.tts.lang;
      lastSpokenIdRef.current = card.id;
      u.onend = () => onEnd();
      currentUtterRef.current = u;
      window.speechSynthesis.speak(u);
    }

    (function speakWithRepeat() {
      speakOnce(() => {
        advanceOrRepeat(
          () => speakWithRepeat(), // 🔁 다시 용어 읽기
          () => {
            // ✅ 반복 끝
            if (readDescription) {
              speakDescriptionThenNext(card); // 설명 1회 읽고 → 다음
            } else if (isPlaying) {
              setIndex((prev) => (prev + 1) % cards.length); // 그냥 다음
            }
          },
        );
      });
    })();
  }

  // 프리페치
  function prefetchAudio(card?: Card) {
    if (!card) return;
    const url = audioUrlOf(card);
    if (audioCache.current.has(url)) return;
    const a = new Audio();
    a.preload = "auto";
    a.src = url;
    audioCache.current.set(url, a);
  }
  useEffect(() => {
    if (!cards.length) return;
    [0, 1, 2].forEach((off) => {
      const idx = logicalIndexToReal((index + off) % cards.length);
      prefetchAudio(cards[idx]);
    });
  }, [index, cards, shuffle, preferAudio]);

  // 자동 진행 타이머 정리
  useEffect(() => {
    if (!isPlaying && advanceTimerRef.current) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, [isPlaying]);

  // 카드 변경 시 재생
  useEffect(() => {
    if (!isPlaying) return; // ← 재생 중일 때만 트리거
    if (!cards.length) return;
    const realIdx = logicalIndexToReal(index % cards.length);
    const card = cards[realIdx];
    if (card) playRecordedOrTTS(card);
  }, [index, cards, ttsRate, preferAudio, isPlaying]);

  useEffect(() => {
    const handle = () => {
      // 필요하면 캐싱하거나, 향후 speak 시 다시 선택
      // const voices = window.speechSynthesis.getVoices();
    };
    window.speechSynthesis.addEventListener?.("voiceschanged", handle);
    return () =>
      window.speechSynthesis.removeEventListener?.("voiceschanged", handle);
  }, []);

  // 옵션 퍼시스턴스
  useEffect(() => {
    localStorage.setItem(LS_KEYS.interval, String(intervalMs));
  }, [intervalMs]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.rate, String(ttsRate));
  }, [ttsRate]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.shuffle, String(shuffle));
  }, [shuffle]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.hide, String(hideTerm));
  }, [hideTerm]);
  useEffect(() => {
    if (selectedFolderId != null)
      localStorage.setItem(LS_KEYS.lastFolder, String(selectedFolderId));
  }, [selectedFolderId]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEYS.folders, JSON.stringify(folders));
    } catch {}
  }, [folders]);

  // 핸들러
  // ✅ 안전 가드
  const next = () => {
    if (!cards.length) return;
    setIndex((i) => (i + 1) % cards.length);
  };
  const prev = () => {
    if (!cards.length) return;
    setIndex((i) => (i - 1 + cards.length) % cards.length);
  };

  const unlockAudio = () => setIsUnlocked(true);

  const openFolder = (id: number, autoplay = false) => {
    setSelectedFolderId(id);
    setIndex(0);
    setView("player");
    setIsPlaying(autoplay);
  };
  const backToLibrary = () => {
    setIsPlaying(false);
    setView("library");
  };

  /* -------------------------
     라이브러리 뷰 (폴더 그리드)
     ------------------------- */
  if (view === "library") {
    return (
      <div className="flex min-h-screen w-full flex-col items-center bg-gradient-to-b from-slate-900 to-slate-800 p-6 text-white">
        <header className="flex w-full max-w-4xl items-center justify-between py-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            플래시카드 폴더
          </h1>
          <div className="text-xs opacity-70">읽기 전용 컨텐츠</div>
        </header>

        <main className="w-full max-w-4xl">
          {combinedFolders.length === 0 ? (
            <div className="text-slate-300">
              폴더가 없습니다. 관리자에게 문의하세요.
            </div>
          ) : (
            <>
              {/* ✅ 내 카드 추가 패널 */}
              <section className="mb-4 rounded-2xl border border-emerald-500/50 bg-emerald-900/20 p-4 text-sm">
                <AddMyCardPanel
                  userFolders={userFolders}
                  onAddCard={(folderName, card) => {
                    setUserFolders((prev) => {
                      const name = (folderName || "").trim() || "내 폴더";
                      const found = prev.find((f) => f.name === name);
                      const nextCardId =
                        Math.max(0, ...(found?.cards ?? []).map((c) => c.id)) +
                        1;
                      const newCard = { ...card, id: nextCardId };

                      if (!found) {
                        return [
                          ...prev,
                          // id는 필요 시 렌더에서 별도 보정 가능
                          { id: Date.now(), name, cards: [newCard] },
                        ];
                      }
                      return prev.map((f) =>
                        f.name === name
                          ? { ...f, cards: [...f.cards, newCard] }
                          : f,
                      );
                    });
                  }}
                  onDeleteCard={(folderName, cardId) => {
                    setUserFolders(
                      (prev) =>
                        prev
                          .map((f) =>
                            f.name === folderName
                              ? {
                                  ...f,
                                  cards: f.cards.filter((c) => c.id !== cardId),
                                }
                              : f,
                          )
                          .filter((f) => f.cards.length > 0), // 카드 비면 폴더 삭제
                    );
                  }}
                  onExport={() => {
                    const blob = new Blob(
                      [JSON.stringify(userFolders, null, 2)],
                      {
                        type: "application/json;charset=utf-8",
                      },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "my-folders.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  onImport={(foldersJson) => {
                    try {
                      const parsed = JSON.parse(foldersJson);
                      if (Array.isArray(parsed)) {
                        setUserFolders(parsed as Folder[]);
                      } else {
                        alert(
                          "JSON 형식이 올바르지 않습니다. 배열이 필요합니다.",
                        );
                      }
                    } catch (e) {
                      alert("JSON 파싱 실패: " + (e as Error).message);
                    }
                  }}
                />
              </section>

              {/* 🔽 읽기 전용 + 내 폴더 그리드 (합쳐서 표시) */}
              <ul className="divide-y divide-slate-700/60 rounded-2xl border border-slate-600 bg-slate-700/30">
                {combinedFolders.map((f) => {
                  const firstWithImage = f.cards.find((c) => !!c.imageUrl);
                  const isUserFolder = userFolders.some(
                    (uf) => uf.name === f.name,
                  );

                  return (
                    <li
                      key={f.id}
                      className="group flex items-center gap-3 p-3 transition-colors hover:bg-slate-700/50 sm:p-4"
                      title={isUserFolder ? "내 폴더" : "읽기 전용 폴더"}
                    >
                      {/* 썸네일 */}
                      <div className="shrink-0">
                        {firstWithImage ? (
                          <img
                            src={firstWithImage.imageUrl!}
                            alt={f.name}
                            className="h-14 w-14 rounded-xl border border-slate-600/70 bg-slate-800/60 object-contain p-1 sm:h-16 sm:w-16"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="grid h-14 w-14 place-items-center rounded-xl border border-dashed border-slate-600/70 text-[10px] text-slate-500 sm:h-16 sm:w-16">
                            없음
                          </div>
                        )}
                      </div>

                      {/* 텍스트 영역 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-semibold">{f.name}</div>
                          {!isUserFolder && (
                            <span className="shrink-0 rounded bg-slate-500/40 px-2 py-[2px] text-[10px]">
                              읽기 전용
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {f.cards.length}개 카드
                        </div>
                      </div>

                      {/* 액션 버튼 */}
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          className="rounded-lg bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-white sm:text-sm"
                          onClick={() => openFolder(f.id, false)}
                          title="폴더 열기"
                        >
                          열기
                        </button>
                        <button
                          className="rounded-lg bg-emerald-400 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-emerald-300 sm:text-sm"
                          onClick={() => openFolder(f.id, true)}
                          title="바로 재생"
                        >
                          재생
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </main>
      </div>
    );
  }

  /* -------------------------
     플레이어 뷰
     ------------------------- */
  const realIdx = cards.length ? logicalIndexToReal(index % cards.length) : 0;
  const current = cards[realIdx];
  const isRevealed = !hideTerm || (current && tempRevealId === current.id);

  return (
    <div className="flex min-h-screen w-full flex-col items-center bg-gradient-to-b from-slate-900 to-slate-800 p-4 text-white">
      <header className="flex w-full max-w-3xl items-center justify-between py-4">
        <button
          onClick={backToLibrary}
          className="rounded-xl bg-slate-200 px-3 py-2 font-semibold text-slate-900 hover:bg-white"
        >
          ← 폴더
        </button>
        <h1 className="text-lg font-semibold tracking-tight">
          {selectedFolder?.name ?? "폴더"}
        </h1>
        <div className="text-xs opacity-70">Audio(mp3) + Web Speech</div>
      </header>

      {!isUnlocked ? (
        <div className="w-full max-w-3xl rounded-2xl border border-slate-600 bg-slate-700/50 p-6 text-center shadow-lg">
          <p className="mb-3">
            브라우저 오디오 정책 때문에 먼저 버튼을 눌러주세요.
          </p>
          <button
            onClick={unlockAudio}
            className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-900 shadow hover:bg-emerald-400"
          >
            오디오 사용 시작
          </button>
        </div>
      ) : null}

      <main className="mt-4 w-full max-w-3xl">
        <div className="relative">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={current?.id ?? "empty"}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.98 }}
              transition={{ duration: 0.3 }}
              className="flex h-auto flex-col justify-center rounded-3xl border border-slate-600 bg-slate-700/40 p-6 shadow-xl select-none"
            >
              {current ? (
                <div>
                  {current.imageUrl ? (
                    <div className="mb-4">
                      <div className="aspect-square w-full overflow-hidden rounded-2xl border border-slate-600/80 bg-slate-800/60">
                        <img
                          src={current.imageUrl}
                          alt={current.term}
                          className="h-full w-full object-contain p-2"
                          loading="eager"
                          decoding="async"
                          fetchPriority="high"
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="mb-2 text-sm text-emerald-300/90 md:text-base">
                    #{realIdx + 1} / {cards.length}
                  </div>

                  {isRevealed ? (
                    <div className="text-3xl font-bold tracking-tight md:text-4xl">
                      {current.term}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 place-items-center rounded-lg bg-slate-600/40 px-4 text-xs text-slate-400 md:h-11">
                        단어 숨김
                      </div>
                      <button
                        className="rounded-lg bg-amber-300 px-3 py-1 text-sm font-semibold text-slate-900 hover:bg-amber-200"
                        onClick={() => setTempRevealId(current.id)}
                      >
                        보기
                      </button>
                    </div>
                  )}

                  {current.description ? (
                    <p className="mt-3 text-base text-slate-300">
                      {current.description}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="text-center text-slate-300">
                  이 폴더에 카드가 없습니다.
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 컨트롤 패널 */}
        {/* 컨트롤 패널 – 새 UI */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* A. 트랜스포트 / 진행 상황 */}
          <div className="rounded-2xl border border-slate-600 bg-slate-800/50 p-4 shadow lg:col-span-2">
            {/* 진행 바 + 인덱스 */}
            <div className="mb-3 flex items-center gap-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{
                    width: cards.length
                      ? `${((realIdx + 1) / cards.length) * 100}%`
                      : "0%",
                  }}
                />
              </div>
              <div className="w-20 text-right text-xs text-slate-300">
                {cards.length ? `${realIdx + 1} / ${cards.length}` : "0 / 0"}
              </div>
            </div>

            {/* 트랜스포트 버튼 행 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* 좌측: 이전/재생/다음 + 다시듣기 + 반복 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={prev}
                  className="group rounded-xl bg-slate-200 px-3 py-2 font-semibold text-slate-900 hover:bg-white active:scale-[0.98]"
                  aria-label="이전"
                  title="이전 (←)"
                >
                  <span className="inline-block transition-transform group-active:-translate-x-0.5">
                    ◀
                  </span>
                </button>

                <button
                  onClick={() => {
                    if (isPlaying) {
                      // ▶ 일시정지: 모든 소리 정리
                      setIsPlaying(false);
                      window.speechSynthesis.cancel();
                      audioCache.current.forEach((a) => {
                        a.pause();
                        a.currentTime = 0;
                        a.onended = null;
                        a.onerror = null;
                      });
                    } else {
                      // ▶ 재생 시작: 현재 카드 즉시 재생
                      setIsPlaying(true);
                      repeatRemainRef.current = repeatCount; // 현재 카드 반복 카운터 초기화
                      const realIdx = cards.length
                        ? logicalIndexToReal(index % cards.length)
                        : 0;
                      const card = cards[realIdx];
                      if (card) playRecordedOrTTS(card);
                    }
                  }}
                  className={`rounded-xl px-4 py-2 font-semibold shadow active:scale-[0.98] ${
                    isPlaying
                      ? "bg-amber-300 text-slate-900 hover:bg-amber-200"
                      : "bg-emerald-400 text-slate-900 hover:bg-emerald-300"
                  }`}
                  aria-label={isPlaying ? "일시정지" : "재생"}
                  title="재생/일시정지 (Space)"
                >
                  {isPlaying ? "⏸ 일시정지" : "▶ 재생"}
                </button>
                <button
                  onClick={next}
                  className="group rounded-xl bg-slate-200 px-3 py-2 font-semibold text-slate-900 hover:bg-white active:scale-[0.98]"
                  aria-label="다음"
                  title="다음 (→)"
                >
                  <span className="inline-block transition-transform group-active:translate-x-0.5">
                    ▶
                  </span>
                </button>

                <button
                  onClick={() => {
                    const idx = cards.length
                      ? logicalIndexToReal(index % cards.length)
                      : 0;
                    const card = cards[idx];
                    if (!card) return;
                    // 다시 듣기: 현재 카드 반복 사이클 리셋 후 재생
                    repeatRemainRef.current = repeatCount;
                    playRecordedOrTTS(card);
                  }}
                  className="rounded-xl bg-indigo-300 px-3 py-2 font-semibold text-slate-900 hover:bg-indigo-200 active:scale-[0.98]"
                  aria-label="다시 듣기"
                  title="현재 카드 다시 듣기 (R)"
                >
                  🔊 다시 듣기
                </button>

                {/* 반복 횟수 */}
                <div className="ml-2 flex items-center gap-2 rounded-xl bg-slate-900/60 px-2 py-1">
                  <span className="text-xs text-slate-300">반복</span>
                  <select
                    value={repeatCount}
                    onChange={(e) =>
                      setRepeatCount(
                        Math.max(1, Math.min(5, Number(e.target.value))),
                      )
                    }
                    className="rounded-md bg-slate-800 px-2 py-1 text-sm"
                    title="카드 당 반복 횟수"
                  >
                    <option value={1}>1회</option>
                    <option value={2}>2회</option>
                    <option value={3}>3회</option>
                    <option value={4}>4회</option>
                    <option value={5}>5회</option>
                  </select>
                </div>
              </div>

              {/* 우측: 퀵 토글들 */}
              <div className="flex items-center gap-3">
                {/* 오디오/브라우저 TTS 세그먼트 */}
                <div
                  className="inline-flex overflow-hidden rounded-xl border border-slate-600"
                  role="tablist"
                  aria-label="재생 방식"
                  title="재생 방식"
                >
                  <button
                    onClick={() => setPreferAudio(true)}
                    className={`px-3 py-1 text-sm ${preferAudio ? "bg-emerald-400 text-slate-900" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
                    role="tab"
                    aria-selected={preferAudio}
                  >
                    Audio
                  </button>
                  <button
                    onClick={() => setPreferAudio(false)}
                    className={`px-3 py-1 text-sm ${!preferAudio ? "bg-emerald-400 text-slate-900" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
                    role="tab"
                    aria-selected={!preferAudio}
                  >
                    TTS
                  </button>
                </div>

                {/* 셔플 스위치 */}
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={shuffle}
                    onChange={(e) => setShuffle(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="text-xs text-slate-300">셔플</span>
                  <span className="h-6 w-10 rounded-full bg-slate-600 p-1 transition peer-checked:bg-emerald-400">
                    <span className="block h-4 w-4 translate-x-0 rounded-full bg-white transition peer-checked:translate-x-4" />
                  </span>
                </label>

                {/* 단어 숨김 스위치 */}
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hideTerm}
                    onChange={(e) => setHideTerm(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="text-xs text-slate-300">단어 숨김</span>
                  <span className="h-6 w-10 rounded-full bg-slate-600 p-1 transition peer-checked:bg-amber-400">
                    <span className="block h-4 w-4 translate-x-0 rounded-full bg-white transition peer-checked:translate-x-4" />
                  </span>
                </label>

                {/* 설명 읽기 스위치 */}
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={readDescription}
                    onChange={(e) => setReadDescription(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="text-xs text-slate-300">설명 읽기</span>
                  <span className="h-6 w-10 rounded-full bg-slate-600 p-1 transition peer-checked:bg-indigo-400">
                    <span className="block h-4 w-4 translate-x-0 rounded-full bg-white transition peer-checked:translate-x-4" />
                  </span>
                </label>
              </div>
            </div>

            {/* 힌트 라인 */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <span>Space: 재생/정지</span>
              <span>←/→: 이전/다음</span>
              <span>R: 다시 듣기</span>
            </div>
          </div>

          {/* B. 상세 옵션 (속도/간격) */}
          <div className="rounded-2xl border border-slate-600 bg-slate-800/50 p-4 shadow">
            <div className="flex flex-col gap-5">
              {/* 전환 간격 */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm">전환 간격</label>
                  <span className="text-xs font-semibold text-slate-300">
                    {(intervalMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10000}
                  step={100}
                  value={intervalMs}
                  onChange={(e) => setIntervalMs(Number(e.target.value))}
                  className="w-full accent-emerald-400"
                  title="카드 전환까지 대기 시간"
                />
              </div>

              {/* TTS 속도 */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm">읽기 속도 (TTS rate)</label>
                  <span className="text-xs font-semibold text-slate-300">
                    {ttsRate.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={ttsRate}
                  onChange={(e) => setTtsRate(Number(e.target.value))}
                  className="w-full accent-emerald-400"
                  title="브라우저 TTS 속도"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 읽기 전용 카드 리스트 */}
        <section className="mt-6 rounded-2xl border border-slate-600 bg-slate-700/40 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            카드 목록 – {selectedFolder?.name}
          </h2>
          <ReadOnlyCardList cards={cards} />
          <div className="mt-2 text-xs text-slate-400">
            이 폴더는 <b>읽기 전용</b>입니다. 카드 추가/수정/삭제가 제한됩니다.
          </div>
        </section>
      </main>

      <footer className="mt-8 text-sm opacity-60">
        ⓘ 팁: 라이브러리에서 폴더를 선택해 재생을 시작하세요.
      </footer>
    </div>
  );
}

/* =========================================================================
   읽기 전용 카드 목록
   ========================================================================= */
function ReadOnlyCardList({ cards }: { cards: Card[] }) {
  return (
    <ul className="mt-2 divide-y divide-slate-600/60">
      {cards.map((c, i) => (
        <li key={c.id} className="flex items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-3">
            {c.imageUrl ? (
              <img
                src={c.imageUrl}
                alt={c.term}
                className="h-12 w-12 rounded-lg border border-slate-600/70 bg-slate-800/60 object-contain p-1"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-slate-600/70 text-xs text-slate-500">
                no img
              </div>
            )}
            <div className="text-sm">
              <span className="font-medium text-slate-200">
                {i + 1}. {c.term}
              </span>
              {/* <span className="block text-xs text-slate-500">
                lang: {c.tts?.lang ?? "(default)"}
                {c.tts?.rate ? ` · rate: ${c.tts.rate}` : ""}
              </span> */}
              {/* ▼ description 표시 */}
              {c.description ? (
                <span className="block text-xs text-slate-400">
                  {c.description}
                </span>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AddMyCardPanel({
  userFolders,
  onAddCard,
  onDeleteCard,
  onExport,
  onImport,
}: {
  userFolders: Folder[];
  onAddCard: (folderName: string, card: Omit<Card, "id">) => void;
  onDeleteCard: (folderName: string, cardId: number) => void;
  onExport: () => void;
  onImport: (jsonText: string) => void;
}) {
  const [folderName, setFolderName] = useState("");
  const [term, setTerm] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [lang, setLang] = useState<"ko-KR" | "en-US">("ko-KR");
  const [rate, setRate] = useState(1);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold">내 카드 추가</h3>
        <div className="flex gap-2">
          <button
            onClick={onExport}
            className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-white"
          >
            내보내기
          </button>
          <label className="cursor-pointer rounded-lg bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-white">
            불러오기
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                onImport(text);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="폴더 이름 (예: 내 단어장)"
          className="rounded-md bg-slate-800 px-3 py-2 outline-none"
        />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="단어/문구 (term)"
          className="rounded-md bg-slate-800 px-3 py-2 outline-none"
        />
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="이미지 URL (선택)"
          className="rounded-md bg-slate-800 px-3 py-2 outline-none"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="설명/예문 (선택)"
          className="rounded-md bg-slate-800 px-3 py-2 outline-none"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs opacity-70">언어</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as any)}
            className="rounded-md bg-slate-800 px-2 py-1"
          >
            <option value="ko-KR">ko-KR</option>
            <option value="en-US">en-US</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs opacity-70">속도</span>
          <input
            type="number"
            min={0.5}
            max={2}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-24 rounded-md bg-slate-800 px-2 py-1"
          />
        </div>
      </div>

      <div className="mt-2">
        <button
          onClick={() => {
            if (!term.trim()) {
              alert("term을 입력하세요.");
              return;
            }
            onAddCard(folderName || "내 폴더", {
              term: term.trim(),
              description: description.trim() || undefined,
              imageUrl: imageUrl.trim() || undefined,
              tts: { lang, rate },
            });
            setTerm("");
            setDescription("");
            setImageUrl("");
          }}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-400"
        >
          + 카드 추가
        </button>
      </div>

      {/* 내 폴더 미니 리스트 (삭제 지원) */}
      {userFolders.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-semibold opacity-80">내 폴더</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {userFolders.map((f) => (
              <div
                key={f.name}
                className="rounded-xl border border-slate-600/70 p-3"
              >
                <div className="mb-1 text-sm font-semibold">{f.name}</div>
                <ul className="space-y-1">
                  {f.cards.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="truncate">{c.term}</span>
                      <button
                        onClick={() => onDeleteCard(f.name, c.id)}
                        className="rounded bg-slate-700 px-2 py-[2px] text-[10px] hover:bg-slate-600"
                        title="삭제"
                      >
                        삭제
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
