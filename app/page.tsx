"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Lang = "cs-CZ" | "en-US";

const LS = {
  lang: "tm_lang",
  green: "tm_green",
  amber: "tm_amber",
  red: "tm_red",
  context: "tm_context",
  notes: "tm_notes",
  myeval: "tm_myeval",
  improvisers: "tm_improvisers",
};

type Improviser = { id: string; name: string; topic: string; transcript?: string; evaluation: string; ts: number };
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Pořadí = priorita: delší / specifičtější fráze první.
const FILLER_WORDS: Record<Lang, string[]> = {
  "cs-CZ": ["tak nějak", "ehm", "ehmm", "em", "emm", "ee", "áá", "hmm", "hm", "mm", "prostě", "takže", "jakoby", "jako", "vlastně", "jaksi", "žejo", "no"],
  "en-US": ["you know", "i mean", "kind of", "sort of", "um", "uhm", "uh", "erm", "er", "hmm", "mm", "like", "basically", "actually", "right", "well", "so"],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Každé písmeno smí být natažené (opakované) → chytí „eeeem“, „ehmmm“, „nooo“…
function fillerPattern(phrase: string): string {
  return phrase
    .trim()
    .split(/\s+/)
    .map((w) =>
      Array.from(w)
        .map((ch) => escapeRe(ch) + "+")
        .join(""),
    )
    .join("\\s+");
}
function fillerRegex(lang: Lang): RegExp {
  const body = FILLER_WORDS[lang].map(fillerPattern).join("|");
  // hranice slova přes unicode písmena (funguje i s diakritikou)
  return new RegExp("(?<![\\p{L}])(" + body + ")(?![\\p{L}])", "giu");
}

export type FillerHit = { word: string; index: number; pre: string; post: string };
function findFillers(t: string, lang: Lang): FillerHit[] {
  if (!t) return [];
  const re = fillerRegex(lang);
  const hits: FillerHit[] = [];
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(t)) && guard++ < 8000) {
    const word = m[0];
    if (!word) {
      re.lastIndex++;
      continue;
    }
    const idx = m.index;
    hits.push({
      word,
      index: idx,
      pre: t.slice(Math.max(0, idx - 42), idx),
      post: t.slice(idx + word.length, idx + word.length + 42),
    });
  }
  return hits;
}

// „ehmm“ / „ehm“ → jedna položka; výstup např. „ehm ×4, jako ×2“
function fillerSummaryFrom(hits: FillerHit[]): string {
  const counts = new Map<string, number>();
  for (const h of hits) {
    const key = h.word.toLowerCase().replace(/(.)\1+/g, "$1").replace(/\s+/g, " ");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w, c]) => `${w} ×${c}`)
    .join(", ");
}

// rychlé štítky pro poznámky za pochodu
const QUICK_TAGS = ["👋 Gesta", "👁️ Oční kontakt", "🚶 Pohyb", "🔊 Hlas", "⏸️ Pauza", "👏 Silný moment", "❓ Nejasné"];

// oddělí sekci „🎙️ Osnova hodnocení“ od zbytku AI výstupu
function splitOutline(md: string): { rest: string; outline: string } {
  const m = md.match(/^##\s*\u{1F399}[^\n]*\n?/mu);
  if (!m || m.index === undefined) return { rest: md, outline: "" };
  return { rest: md.slice(0, m.index), outline: md.slice(m.index + m[0].length) };
}

const I18N = {
  "cs-CZ": { tr: "Přepis projevu", thinking: "Analyzuji projev…" },
  "en-US": { tr: "Speech transcript", thinking: "Analyzing the speech…" },
} as const;

function fmt(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function countWords(t: string): number {
  const m = t.trim().match(/\S+/g);
  return m ? m.length : 0;
}
// ---- mini Markdown -> HTML ----
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}
function inline(s: string): string {
  let r = escapeHtml(s);
  r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  r = r.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  r = r.replace(/`([^`]+)`/g, "<code>$1</code>");
  return r;
}
function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  let html = "";
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      closeList();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#{1,3}\s+(.*)$/))) {
      closeList();
      html += `<h2 class="r">${inline(m[1])}</h2>`;
      continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== "ul") {
        closeList();
        list = "ul";
        html += "<ul>";
      }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== "ol") {
        closeList();
        list = "ol";
        html += "<ol>";
      }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

export default function Page() {
  const [lang, setLang] = useState<Lang>("cs-CZ");
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [evalHtml, setEvalHtml] = useState("");
  const [evalMd, setEvalMd] = useState("");
  const [myEval, setMyEval] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const [green, setGreen] = useState(300);
  const [amber, setAmber] = useState(360);
  const [red, setRed] = useState(420);
  const [context, setContext] = useState("");
  const [notes, setNotes] = useState("");
  const [showFillers, setShowFillers] = useState(false);

  // záložky + improvizace
  const [tab, setTab] = useState<"speech" | "improv">("speech");
  const [improvisers, setImprovisers] = useState<Improviser[]>([]);
  const [impName, setImpName] = useState("");
  const [impTopic, setImpTopic] = useState("");
  const [impTranscript, setImpTranscript] = useState("");
  const [impEval, setImpEval] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [impRecording, setImpRecording] = useState(false);
  const [impElapsed, setImpElapsed] = useState(0);
  const [impBusy, setImpBusy] = useState(false);

  const impRecogRef = useRef<any>(null);
  const impRecordingRef = useRef(false);
  const impFinalRef = useRef("");
  const impStartTsRef = useRef(0);
  const impTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const recogRef = useRef<any>(null);
  const recordingRef = useRef(false);
  const finalTextRef = useRef("");
  const startTsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // načtení nastavení z localStorage
  useEffect(() => {
    const sl = (localStorage.getItem(LS.lang) as Lang) || "cs-CZ";
    setLang(sl === "en-US" ? "en-US" : "cs-CZ");
    const g = localStorage.getItem(LS.green);
    const a = localStorage.getItem(LS.amber);
    const r = localStorage.getItem(LS.red);
    const c = localStorage.getItem(LS.context);
    const n = localStorage.getItem(LS.notes);
    const me = localStorage.getItem(LS.myeval);
    if (g) setGreen(+g);
    if (a) setAmber(+a);
    if (r) setRed(+r);
    if (c) setContext(c);
    if (n) setNotes(n);
    if (me) setMyEval(me);
    try {
      const imp = localStorage.getItem(LS.improvisers);
      if (imp) setImprovisers(JSON.parse(imp));
    } catch {
      /* ignoruj poškozená data */
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);

  const persist = (key: string, val: string) => localStorage.setItem(key, val);

  const changeLang = (l: Lang) => {
    setLang(l);
    persist(LS.lang, l);
    if (recogRef.current) recogRef.current.lang = l;
  };

  // odvozené statistiky
  const words = useMemo(() => countWords(transcript), [transcript]);
  const fillerHits = useMemo(() => findFillers(transcript, lang), [transcript, lang]);
  const fillers = fillerHits.length;
  const wpm = elapsed > 5 && words > 0 ? Math.round(words / (elapsed / 60)) : null;

  // ---- rozpoznávání řeči ----
  const buildRecognizer = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalTextRef.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      setTranscript(finalTextRef.current + interim);
    };
    r.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        showToast("Mikrofon nepovolen. Povol přístup k mikrofonu a zkus to znovu.");
        stopRecording(false);
      } else {
        showToast("Chyba rozpoznávání: " + e.error);
      }
    };
    r.onend = () => {
      if (recordingRef.current) {
        try {
          r.start();
        } catch {
          /* už běží */
        }
      }
    };
    return r;
  }, [lang, showToast]);

  const startRecording = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      showToast("Prohlížeč nepodporuje rozpoznávání řeči — použij Chrome/Edge, nebo vlož přepis ručně.");
      return;
    }
    finalTextRef.current = transcript ? transcript.replace(/\s*$/, "") + " " : "";
    const r = buildRecognizer();
    recogRef.current = r;
    try {
      r.start();
    } catch (e: any) {
      showToast("Nelze spustit nahrávání: " + e.message);
      return;
    }
    recordingRef.current = true;
    setRecording(true);
    setHasStarted(true);
    startTsRef.current = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
    }, 250);
    setElapsed(0);
  }, [transcript, buildRecognizer, showToast]);

  const stopRecording = useCallback(
    (thenAnalyze: boolean) => {
      recordingRef.current = false;
      setRecording(false);
      if (recogRef.current) {
        try {
          recogRef.current.stop();
        } catch {
          /* noop */
        }
        recogRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      finalTextRef.current = transcript;
      if (thenAnalyze && transcript.trim()) {
        // malé zpoždění, ať se stav ustálí
        setTimeout(() => analyze(), 50);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transcript],
  );

  // ---- volání serverové API route ----
  const analyze = useCallback(async () => {
    const t = transcript.trim();
    if (!t) {
      showToast("Přepis je prázdný — nejdřív nahraj nebo vlož projev.");
      return;
    }
    if (recordingRef.current) stopRecording(false);

    setBusy(true);
    setEvalHtml("");
    setEvalMd("");

    try {
      const resp = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lang,
          transcript: t,
          durationSec: startTsRef.current ? Math.floor((Date.now() - startTsRef.current) / 1000) : elapsed,
          wordCount: countWords(t),
          context,
          fillerSummary: fillerSummaryFrom(findFillers(t, lang)),
          notes,
          greenSec: green,
          redSec: red,
        }),
      });

      if (!resp.ok || !resp.body) {
        let msg = "HTTP " + resp.status;
        try {
          const j = await resp.json();
          if (j.error) msg = j.error;
        } catch {
          /* noop */
        }
        throw new Error(msg);
      }

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setEvalMd(acc);
        // osnova hodnocení jde zvlášť do editovatelného pole „Moje hodnocení“
        const { rest, outline } = splitOutline(acc);
        setEvalHtml(renderMarkdown(rest));
        if (outline.trim()) setMyEval(outline.replace(/\*\*/g, "").trim());
      }
      if (!acc.trim()) setEvalHtml('<div class="placeholder">Model nevrátil žádný text. Zkus to znovu.</div>');
      const { outline: finalOutline } = splitOutline(acc);
      if (finalOutline.trim()) {
        const merged =
          finalOutline.replace(/\*\*/g, "").trim() +
          (notes.trim() ? "\n\n––– Moje poznámky z místnosti –––\n" + notes.trim() : "");
        setMyEval(merged);
        persist(LS.myeval, merged);
      }
    } catch (err: any) {
      setEvalHtml(
        '<div class="placeholder">⚠️ Chyba: ' +
          escapeHtml(err?.message || "neznámá") +
          "<br><br>Zkontroluj, že je na serveru nastavená proměnná ANTHROPIC_API_KEY.</div>",
      );
    } finally {
      setBusy(false);
    }
  }, [transcript, lang, context, notes, green, red, elapsed, showToast, stopRecording]);

  // rychlá poznámka se štítkem a časovou značkou (během nahrávání)
  const addQuickNote = (label: string) => {
    const ts = recordingRef.current || elapsed > 0 ? `[${fmt(elapsed)}] ` : "";
    const next = (notes.trim() ? notes.replace(/\s*$/, "") + "\n" : "") + ts + label + ": ";
    setNotes(next);
    persist(LS.notes, next);
    requestAnimationFrame(() => {
      const ta = notesRef.current;
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
        ta.scrollTop = ta.scrollHeight;
      }
    });
  };

  const copyText = async (text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Zkopírováno do schránky.");
    } catch {
      showToast("Kopírování se nepovedlo.");
    }
  };

  // úklid při odmontování
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (impTimerRef.current) clearInterval(impTimerRef.current);
      for (const ref of [recogRef, impRecogRef]) {
        if (ref.current) {
          try {
            ref.current.stop();
          } catch {
            /* noop */
          }
        }
      }
    };
  }, []);

  const clearAll = () => {
    setTranscript("");
    finalTextRef.current = "";
    setEvalHtml("");
    setEvalMd("");
    setElapsed(0);
  };

  // ---- improvizace (localStorage) ----
  const persistImprovisers = (list: Improviser[]) => {
    setImprovisers(list);
    localStorage.setItem(LS.improvisers, JSON.stringify(list));
  };
  const resetImpForm = () => {
    setEditingId(null);
    setImpName("");
    setImpTopic("");
    setImpTranscript("");
    setImpEval("");
    setImpElapsed(0);
    if (impRecordingRef.current) stopImpRec();
  };
  const submitImproviser = () => {
    const name = impName.trim();
    if (!name) {
      showToast("Zadej jméno improvizátora.");
      return;
    }
    if (editingId) {
      persistImprovisers(
        improvisers.map((im) =>
          im.id === editingId
            ? { ...im, name, topic: impTopic.trim(), transcript: impTranscript.trim(), evaluation: impEval }
            : im,
        ),
      );
    } else {
      const item: Improviser = {
        id: genId(),
        name,
        topic: impTopic.trim(),
        transcript: impTranscript.trim(),
        evaluation: impEval,
        ts: Date.now(),
      };
      persistImprovisers([item, ...improvisers]);
    }
    resetImpForm();
    showToast("Uloženo.");
  };
  const editImproviser = (im: Improviser) => {
    setEditingId(im.id);
    setImpName(im.name);
    setImpTopic(im.topic);
    setImpTranscript(im.transcript || "");
    setImpEval(im.evaluation);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const deleteImproviser = (id: string) => {
    persistImprovisers(improvisers.filter((im) => im.id !== id));
    if (editingId === id) resetImpForm();
  };
  const impDate = (ts: number) =>
    new Date(ts).toLocaleString("cs-CZ", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // ---- nahrávání odpovědi improvizátora ----
  const startImpRec = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      showToast("Prohlížeč nepodporuje rozpoznávání řeči — použij Chrome/Edge nebo vlož odpověď ručně.");
      return;
    }
    impFinalRef.current = impTranscript ? impTranscript.replace(/\s*$/, "") + " " : "";
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) impFinalRef.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      setImpTranscript(impFinalRef.current + interim);
    };
    r.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        showToast("Mikrofon nepovolen.");
        stopImpRec();
      } else {
        showToast("Chyba rozpoznávání: " + e.error);
      }
    };
    r.onend = () => {
      if (impRecordingRef.current) {
        try {
          r.start();
        } catch {
          /* už běží */
        }
      }
    };
    impRecogRef.current = r;
    try {
      r.start();
    } catch (e: any) {
      showToast("Nelze spustit nahrávání: " + e.message);
      return;
    }
    impRecordingRef.current = true;
    setImpRecording(true);
    impStartTsRef.current = Date.now();
    if (impTimerRef.current) clearInterval(impTimerRef.current);
    impTimerRef.current = setInterval(
      () => setImpElapsed(Math.floor((Date.now() - impStartTsRef.current) / 1000)),
      250,
    );
    setImpElapsed(0);
  };
  const stopImpRec = () => {
    impRecordingRef.current = false;
    setImpRecording(false);
    if (impRecogRef.current) {
      try {
        impRecogRef.current.stop();
      } catch {
        /* noop */
      }
      impRecogRef.current = null;
    }
    if (impTimerRef.current) {
      clearInterval(impTimerRef.current);
      impTimerRef.current = null;
    }
  };
  const evaluateImprov = async () => {
    const t = impTranscript.trim();
    if (!t) {
      showToast("Nejdřív nahraj nebo vlož odpověď improvizátora.");
      return;
    }
    if (impRecordingRef.current) stopImpRec();
    setImpBusy(true);
    setImpEval("");
    try {
      const resp = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang, mode: "improv", topic: impTopic, transcript: t }),
      });
      if (!resp.ok || !resp.body) {
        let msg = "HTTP " + resp.status;
        try {
          const j = await resp.json();
          if (j.error) msg = j.error;
        } catch {
          /* noop */
        }
        throw new Error(msg);
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setImpEval(acc);
      }
    } catch (err: any) {
      showToast("Chyba hodnocení: " + (err?.message || "neznámá"));
    } finally {
      setImpBusy(false);
    }
  };

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>
            🎤 Hodnotitel projevů <span>· Toastmasters</span>
          </h1>
          <div className="sub">Poslouchá projev, přepíše ho a připraví ti podklad pro hodnocení.</div>
        </div>
        <div className="langtab">
          <button className={lang === "cs-CZ" ? "active" : ""} onClick={() => changeLang("cs-CZ")}>
            Čeština
          </button>
          <button className={lang === "en-US" ? "active" : ""} onClick={() => changeLang("en-US")}>
            English
          </button>
        </div>
      </header>

      <div className="tabs">
        <button className={tab === "speech" ? "active" : ""} onClick={() => setTab("speech")}>
          🎤 Hodnocení projevu
        </button>
        <button className={tab === "improv" ? "active" : ""} onClick={() => setTab("improv")}>
          💬 Improvizace
        </button>
      </div>

      {tab === "speech" && (
      <div className="grid">
        {/* LEVÝ SLOUPEC */}
        <div>
          <div className="card timer">
            <h2>Časomíra</h2>
            <div className="clock">{fmt(elapsed)}</div>
            <div className="signal">
              <div className={"light g" + (elapsed >= green ? " on" : "")} />
              <div className={"light a" + (elapsed >= amber ? " on" : "")} />
              <div className={"light r" + (elapsed >= red ? " on" : "")} />
            </div>
            <div className="target">
              🟢 {fmt(green)}&nbsp;&nbsp;&nbsp;🟡 {fmt(amber)}&nbsp;&nbsp;&nbsp;🔴 {fmt(red)}
            </div>
            {!recording ? (
              <div className="btn-row">
                <button className="btn primary" onClick={startRecording}>
                  ● {hasStarted ? "Nahrávat znovu" : "Spustit nahrávání"}
                </button>
              </div>
            ) : (
              <div className="btn-row">
                <button className="btn danger" onClick={() => stopRecording(true)}>
                  ■ Stop &amp; vyhodnotit
                </button>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="stats">
              <div className="stat">
                <b>{words}</b>
                <span>slov</span>
              </div>
              <div className="stat">
                <b>{wpm ?? "–"}</b>
                <span>slov/min</span>
              </div>
              <button
                type="button"
                className={"stat filler-stat" + (fillers ? " clickable" : "")}
                onClick={() => fillers && setShowFillers((s) => !s)}
                disabled={!fillers}
                title={fillers ? "Zobrazit konkrétní výplňová slova" : "Zatím žádná výplňová slova"}
              >
                <b>{fillers}</b>
                <span>výplňová slova {fillers ? (showFillers ? "▾" : "▸") : ""}</span>
              </button>
            </div>
            {showFillers && fillers > 0 && (
              <div className="filler-list">
                {fillerHits.map((h, i) => (
                  <div className="filler-item" key={i}>
                    <span className="ctx">{h.pre ? "…" + h.pre : ""}</span>
                    <mark>{h.word}</mark>
                    <span className="ctx">{h.post ? h.post + "…" : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <details className="settings">
              <summary>⚙️ Nastavení (signální časy, kontext)</summary>
              <label className="field">Signální časy (sekundy: zelená / žlutá / červená)</label>
              <div className="row3">
                <input
                  type="number"
                  value={green}
                  onChange={(e) => {
                    setGreen(+e.target.value);
                    persist(LS.green, e.target.value);
                  }}
                />
                <input
                  type="number"
                  value={amber}
                  onChange={(e) => {
                    setAmber(+e.target.value);
                    persist(LS.amber, e.target.value);
                  }}
                />
                <input
                  type="number"
                  value={red}
                  onChange={(e) => {
                    setRed(+e.target.value);
                    persist(LS.red, e.target.value);
                  }}
                />
              </div>
              <label className="field">Kontext projevu (volitelné — téma, typ, cíl řečníka)</label>
              <textarea
                style={{ minHeight: 64 }}
                placeholder="Např.: Icebreaker, první projev. Cíl: představit se."
                value={context}
                onChange={(e) => {
                  setContext(e.target.value);
                  persist(LS.context, e.target.value);
                }}
              />
            </details>
          </div>
        </div>

        {/* PRAVÝ SLOUPEC */}
        <div>
          <div className="card">
            <h2>✏️ Moje poznámky</h2>
            <div className="tagrow">
              {QUICK_TAGS.map((t) => (
                <button key={t} type="button" className="tag" onClick={() => addQuickNote(t)} title="Přidá poznámku s časem projevu">
                  {t}
                </button>
              ))}
            </div>
            <textarea
              ref={notesRef}
              className="note-paper"
              style={{ minHeight: 160 }}
              placeholder="Klikni na štítek nahoře (vloží se i čas projevu), nebo piš rovnou — řeč těla, gesta, energie… AI je zapracuje do hodnocení. Uloží se automaticky."
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                persist(LS.notes, e.target.value);
              }}
            />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>{I18N[lang].tr}</h2>
            <textarea
              className="transcript note-paper"
              placeholder="Tady se objeví živý přepis… Můžeš ho i ručně upravit nebo vložit vlastní text a kliknout na „Vyhodnotit“."
              value={transcript}
              onChange={(e) => {
                setTranscript(e.target.value);
                finalTextRef.current = e.target.value;
              }}
            />
            <div className="btn-row">
              <button className="btn" onClick={analyze} disabled={busy}>
                ✨ Vyhodnotit přepis
              </button>
              <button className="btn" onClick={clearAll}>
                Vymazat
              </button>
            </div>
          </div>

          <div className="card highlight" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h2>🎙️ Moje hodnocení — čti odsud</h2>
              {myEval.trim() && (
                <button type="button" className="btn-sm" onClick={() => copyText(myEval)}>
                  📋 Zkopírovat
                </button>
              )}
            </div>
            <textarea
              className="note-paper"
              style={{ minHeight: 220 }}
              value={myEval}
              onChange={(e) => {
                setMyEval(e.target.value);
                persist(LS.myeval, e.target.value);
              }}
              placeholder="Po vyhodnocení se sem vloží osnova hodnocení od AI + tvoje poznámky z místnosti. Uprav si text podle sebe — při hodnocení pak čteš rovnou odsud."
            />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h2>Tahák od AI</h2>
              {evalMd.trim() && !busy && (
                <button type="button" className="btn-sm" onClick={() => copyText(evalMd)}>
                  📋 Zkopírovat
                </button>
              )}
            </div>
            <div className="eval">
              {busy && !evalHtml ? (
                <div className="placeholder">
                  <span className="spin" />
                  {I18N[lang].thinking}
                </div>
              ) : evalHtml ? (
                <div dangerouslySetInnerHTML={{ __html: evalHtml }} />
              ) : (
                <div className="placeholder">
                  Po skončení projevu (nebo kliknutí na „Vyhodnotit“) se tu objeví stručný tahák:
                  <br />
                  co pochválit, co doporučit a citace. Osnova k přečtení se vloží nahoru do „Moje hodnocení“.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      {tab === "improv" && (
        <div className="improv">
          <div className="card">
            <h2>{editingId ? "✏️ Upravit hodnocení" : "➕ Nový improvizátor"}</h2>
            <label className="field">Jméno improvizátora</label>
            <input
              type="text"
              value={impName}
              onChange={(e) => setImpName(e.target.value)}
              placeholder="Např. Jana N."
            />
            <label className="field">Téma / otázka (volitelné)</label>
            <input
              type="text"
              value={impTopic}
              onChange={(e) => setImpTopic(e.target.value)}
              placeholder="Zadané téma Table Topics…"
            />
            <label className="field">Odpověď improvizátora (přepis)</label>
            <div className="imp-rec">
              {!impRecording ? (
                <button type="button" className="btn" onClick={startImpRec}>
                  ● Nahrávat odpověď
                </button>
              ) : (
                <button type="button" className="btn danger" onClick={stopImpRec}>
                  ■ Stop
                </button>
              )}
              <span className="imp-clock">{fmt(impElapsed)}</span>
            </div>
            <textarea
              className="note-paper"
              style={{ minHeight: 110 }}
              value={impTranscript}
              onChange={(e) => {
                setImpTranscript(e.target.value);
                impFinalRef.current = e.target.value;
              }}
              placeholder="Přepis odpovědi… (nebo vlož / uprav ručně)"
            />
            <div className="btn-row">
              <button type="button" className="btn" onClick={evaluateImprov} disabled={impBusy}>
                {impBusy ? (
                  <>
                    <span className="spin" />
                    Vyhodnocuji…
                  </>
                ) : (
                  "✨ Vyhodnotit odpověď (AI)"
                )}
              </button>
            </div>

            <label className="field">Hodnocení (AI návrh — uprav podle sebe)</label>
            <textarea
              className="note-paper"
              style={{ minHeight: 140 }}
              value={impEval}
              onChange={(e) => setImpEval(e.target.value)}
              placeholder="Sem přijde AI hodnocení odpovědi — můžeš ho upravit, než uložíš. Nebo napiš vlastní."
            />
            <div className="btn-row">
              <button className="btn primary" onClick={submitImproviser}>
                {editingId ? "Uložit změny" : "Uložit improvizátora"}
              </button>
              {editingId && (
                <button className="btn" onClick={resetImpForm}>
                  Zrušit úpravu
                </button>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Uložení improvizátoři ({improvisers.length})</h2>
            {improvisers.length === 0 ? (
              <div className="placeholder">Zatím nikdo uložený. Přidej improvizátora formulářem nahoře.</div>
            ) : (
              <div className="imp-list">
                {improvisers.map((im) => (
                  <div className="imp-item" key={im.id}>
                    <div className="imp-head">
                      <div className="imp-name">{im.name}</div>
                      <div className="imp-actions">
                        <button className="btn-sm" onClick={() => editImproviser(im)}>
                          Upravit
                        </button>
                        <button className="btn-sm danger" onClick={() => deleteImproviser(im.id)}>
                          Smazat
                        </button>
                      </div>
                    </div>
                    {im.topic && <div className="imp-topic">💡 {im.topic}</div>}
                    {im.evaluation.trim() && <div className="imp-eval">{im.evaluation}</div>}
                    <div className="imp-meta">{impDate(im.ts)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <footer>
        Soukromí: zvuk se přepisuje přes rozpoznávání řeči v prohlížeči (Chrome posílá audio Googlu), přepis se posílá na
        server appky a odtud Anthropicu k vyhodnocení.
        <br />
        AI slyší jen zvuk — řeč těla, oční kontakt a gesta posuzuješ ty. Funguje nejlépe v Chrome / Edge.
      </footer>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}
