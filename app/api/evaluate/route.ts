import Anthropic from "@anthropic-ai/sdk";

// Běží na Node runtime (kvůli streamování a SDK). Na Vercelu povolíme delší běh.
export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  lang?: string;
  transcript?: string;
  durationSec?: number;
  wordCount?: number;
  context?: string;
};

function systemPrompt(lang: string): string {
  if (lang === "en-US") {
    return `You are an experienced Toastmasters speech evaluator. You are given ONLY the audio transcript of a prepared speech — you cannot see body language, gestures, eye contact, or slides, so do NOT comment on those. Judge only what is audible/textual: opening hook, structure (opening/body/close), clarity of the core message, word choice and language, rhetorical devices, humor, vocal variety and pacing as far as inferable, filler words and verbal crutches, and the closing / call to action.

Use the Toastmasters CRC approach (Commend – Recommend – Commend): be warm, specific and encouraging, but give honest, actionable improvement points. Always ground praise and suggestions in CONCRETE moments or short quotes from the transcript.

Write the evaluation so a busy evaluator can skim it and read parts aloud. Output GitHub-flavored Markdown ONLY (no preamble, no meta-commentary), using exactly these section headings:

## Overall impression
(1–2 sentences.)

## 💪 What worked — highlight these
(3–5 bullets, each with a concrete moment/quote.)

## 🔧 What to improve
(2–4 specific, actionable bullets.)

## 🗣️ Delivery notes (audible only)
(Structure, pacing, filler words, clarity, vocal variety. Mention notable filler words if any.)

## 📌 Memorable moments
(1–3 quotable lines or strong images from the speech.)

## ✨ One tip for next time
(A single, focused suggestion.)`;
  }
  return `Jsi zkušený hodnotitel projevů v Toastmasters. Dostaneš POUZE textový přepis připraveného projevu (z rozpoznávání řeči, může obsahovat drobné chyby). NEVIDÍŠ řeč těla, gesta, oční kontakt ani slajdy — proto je vůbec nekomentuj. Hodnoť jen to, co je slyšet / je v textu: úvodní háček, strukturu (úvod / tělo / závěr), srozumitelnost hlavního sdělení, výběr slov a jazyk, rétorické prostředky, humor, tempo a hlasovou variabilitu (nakolik se dá odvodit), výplňová slova a slovní vatu, a závěr / výzvu k akci.

Použij přístup Toastmasters CRC (Pochval – Doporuč – Pochval): buď vstřícný, konkrétní a povzbudivý, ale dej upřímná a akční doporučení ke zlepšení. Pochvaly i doporučení vždy opři o KONKRÉTNÍ momenty nebo krátké citace z přepisu.

Piš tak, aby si to hodnotitel mohl rychle proletět očima a část přečíst nahlas. Vrať POUZE Markdown (žádný úvod ani meta-komentář), přesně s těmito nadpisy:

## Celkový dojem
(1–2 věty.)

## 💪 Co se povedlo — tohle vypíchni
(3–5 odrážek, každá s konkrétním momentem/citací.)

## 🔧 Co zlepšit
(2–4 konkrétní, akční odrážky.)

## 🗣️ Poznámky k přednesu (jen slyšitelné)
(Struktura, tempo, výplňová slova, srozumitelnost, hlasová variabilita. Zmiň výrazná výplňová slova, pokud nějaká jsou.)

## 📌 Zapamatovatelné momenty
(1–3 citovatelné věty nebo silné obrazy z projevu.)

## ✨ Jeden tip na příště
(Jedno cílené doporučení.)`;
}

function fmt(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function userMessage(b: Body, lang: string): string {
  const en = lang === "en-US";
  const meta: string[] = [];
  if (b.durationSec && b.durationSec > 0) meta.push((en ? "Duration: " : "Délka: ") + fmt(b.durationSec));
  if (b.wordCount && b.wordCount > 0) meta.push((en ? "Word count: " : "Počet slov: ") + b.wordCount);
  const ctx = (b.context || "").trim();
  if (ctx) meta.push((en ? "Context: " : "Kontext: ") + ctx);
  const head = meta.length ? meta.join("\n") + "\n\n" : "";
  const label = en ? "TRANSCRIPT:\n" : "PŘEPIS:\n";
  return head + label + (b.transcript || "").trim();
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Na serveru chybí ANTHROPIC_API_KEY (nastav ji v env proměnných)." }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Neplatný požadavek." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const transcript = (body.transcript || "").trim();
  if (!transcript) {
    return new Response(JSON.stringify({ error: "Přepis je prázdný." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const lang = body.lang === "en-US" ? "en-US" : "cs-CZ";
  const client = new Anthropic();

  try {
    const stream = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      stream: true,
      system: systemPrompt(lang),
      messages: [{ role: "user", content: userMessage(body, lang) }],
    });

    const encoder = new TextEncoder();
    const rs = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              "\n\n⚠️ " + (err instanceof Error ? err.message : "Chyba streamu."),
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(rs, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznámá chyba volání Claude API.";
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
