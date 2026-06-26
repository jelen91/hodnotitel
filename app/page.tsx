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
};

const FILLERS: Record<Lang, string[]> = {
  "cs-CZ": ["ehm", "ehmm", "em", "hmm", "prostě", "takže", "jako", "no", "vlastně", "jaksi", "žejo", "jakoby", "tak nějak"],
  "en-US": ["um", "uh", "like", "you know", "so", "basically", "actually", "kind of", "sort of", "i mean", "right"],
};

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
function countFillers(t: string, lang: Lang): number {
  const low = " " + t.toLowerCase().replace(/[.,!?;:]/g, " ") + " ";
  let n = 0;
  for (const f of FILLERS[lang]) {
    const re = new RegExp("\\s" + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s", "g");
    const mm = low.match(re);
    if (mm) n += mm.length;
  }
  return n;
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
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const [green, setGreen] = useState(300);
  const [amber, setAmber] = useState(360);
  const [red, setRed] = useState(420);
  const [context, setContext] = useState("");
  const [notes, setNotes] = useState("");

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
    if (g) setGreen(+g);
    if (a) setAmber(+a);
    if (r) setRed(+r);
    if (c) setContext(c);
    if (n) setNotes(n);
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
  const fillers = useMemo(() => countFillers(transcript, lang), [transcript, lang]);
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
        setEvalHtml(renderMarkdown(acc));
      }
      if (!acc.trim()) setEvalHtml('<div class="placeholder">Model nevrátil žádný text. Zkus to znovu.</div>');
    } catch (err: any) {
      setEvalHtml(
        '<div class="placeholder">⚠️ Chyba: ' +
          escapeHtml(err?.message || "neznámá") +
          "<br><br>Zkontroluj, že je na serveru nastavená proměnná ANTHROPIC_API_KEY.</div>",
      );
    } finally {
      setBusy(false);
    }
  }, [transcript, lang, context, elapsed, showToast, stopRecording]);

  // úklid při odmontování
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recogRef.current) {
        try {
          recogRef.current.stop();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  const clearAll = () => {
    setTranscript("");
    finalTextRef.current = "";
    setEvalHtml("");
    setElapsed(0);
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
              <div className="stat">
                <b>{fillers}</b>
                <span>výplňová slova</span>
              </div>
            </div>
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
            <textarea
              className="note-paper"
              style={{ minHeight: 160 }}
              placeholder="Sem si piš vlastní postřehy během projevu — řeč těla, gesta, oční kontakt, energie, hlas… Uloží se automaticky."
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

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Hodnocení pro tebe</h2>
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
                  Po skončení projevu (nebo kliknutí na „Vyhodnotit“) se tu objeví shrnutí:
                  <br />
                  co vypíchnout, co zlepšit a zapamatovatelné momenty.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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
