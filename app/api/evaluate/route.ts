import Anthropic from "@anthropic-ai/sdk";

// Běží na Node runtime (kvůli streamování a SDK). Na Vercelu povolíme delší běh.
export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  lang?: string;
  mode?: "speech" | "improv";
  topic?: string;
  transcript?: string;
  durationSec?: number;
  wordCount?: number;
  context?: string;
  fillerSummary?: string;
  notes?: string;
  greenSec?: number;
  redSec?: number;
};

function systemPrompt(lang: string): string {
  if (lang === "en-US") {
    return `You are an experienced Toastmasters speech evaluator. You get ONLY the speech-recognition transcript of a prepared speech (may contain minor errors), plus stats (duration, pace, filler words, time limits) and possibly the evaluator's own notes from the room. You cannot see body language, gestures or slides — never comment on them yourself, but if the evaluator's notes mention them, DO work those observations in.

Your output is a CHEAT SHEET the evaluator skims while preparing a 2–3 minute spoken evaluation (CRC: Commend – Recommend – Commend). Therefore:
- Telegraphic style, no long paragraphs.
- Each bullet max ~12 words, starting with a bold keyword.
- Ground every commendation and recommendation in a concrete moment or short "…" quote from the transcript.
- Every recommendation must include a concrete HOW for next time, not just what was wrong.
- If duration and time limits are given, cover timing in one bullet (commend or recommend).

Output Markdown ONLY (no preamble, no meta-commentary), exactly these sections:

## ⚡ Overall impression
(One sentence.)

## 💪 Commend
(3–5 bullets: **keyword** — moment/quote.)

## 🔧 Recommend
(2–3 bullets: **what** — how to do it next time. Most important first.)

## 📌 Quotes worth repeating
(1–3 short verbatim quotes from the speech.)

## 🎙️ Evaluation outline (read this aloud)
(5–7 short lines of a spoken CRC evaluation: address + overall impression → 2 commendations → 1–2 recommendations → closing encouragement. One natural spoken sentence per line.)`;
  }
  return `Jsi zkušený hodnotitel projevů v Toastmasters. Dostaneš POUZE textový přepis připraveného projevu (z rozpoznávání řeči, může obsahovat drobné chyby), k tomu statistiky (délka, tempo, výplňová slova, časové limity) a případně vlastní poznámky hodnotitele z místnosti. NEVIDÍŠ řeč těla, gesta ani slajdy — sám je nikdy nekomentuj, ale pokud je hodnotitel zmiňuje ve svých poznámkách, jeho postřehy ZAPRACUJ.

Tvůj výstup je TAHÁK, který si hodnotitel rychle proletí při přípravě 2–3minutového mluveného hodnocení (CRC: Pochval – Doporuč – Pochval). Proto:
- Piš heslovitě, žádné dlouhé odstavce.
- Každá odrážka max ~12 slov, začni tučným klíčovým slovem.
- Každou pochvalu i doporučení opři o konkrétní moment nebo krátkou citaci „…“ z přepisu.
- Každé doporučení musí obsahovat konkrétní JAK na příště, ne jen co bylo špatně.
- Pokud znáš délku a časové limity, věnuj timingu jednu odrážku (pochvalu, nebo doporučení).

Vrať POUZE Markdown (žádný úvod ani meta-komentář), přesně tyto sekce:

## ⚡ Celkový dojem
(Jedna věta.)

## 💪 Pochval
(3–5 odrážek: **klíčové slovo** — moment/citace.)

## 🔧 Doporuč
(2–3 odrážky: **co** — jak na to příště. Nejdůležitější první.)

## 📌 Citace k zopakování
(1–3 krátké doslovné citace z projevu.)

## 🎙️ Osnova hodnocení (můžeš rovnou číst)
(5–7 krátkých řádků mluveného hodnocení podle CRC: oslovení + celkový dojem → 2 pochvaly → 1–2 doporučení → závěrečné povzbuzení. Každý řádek jedna přirozená mluvená věta.)`;
}

function improvSystemPrompt(lang: string): string {
  if (lang === "en-US") {
    return `You are a Table Topics (impromptu speaking) evaluator at Toastmasters. You are given the topic/question and ONLY the audio transcript of a SHORT impromptu answer (≈1–2 minutes). You cannot see body language, so do NOT comment on it. Judge only what is audible/textual: did they directly answer the question, structure (a clear opening – one point – a close), use of the time, conviction and commitment, vivid/concrete language, and fluency (rambling, filler words).

Give SHORT, telegraphic, encouraging feedback the evaluator can read aloud on the spot. Output PLAIN TEXT only — no Markdown, no "#", no "**". 4–6 short lines, each max ~12 words, use "- " dashes. Start with one genuine strength (with a concrete moment), give 1–2 concrete suggestions, end with a one-line encouragement.`;
  }
  return `Jsi hodnotitel improvizovaných odpovědí (Table Topics) v Toastmasters. Dostaneš téma/otázku a POUZE textový přepis KRÁTKÉ improvizované odpovědi (≈1–2 minuty). Nevidíš řeč těla, tak ji nekomentuj. Hodnoť jen to, co je slyšet / je v textu: zda přímo odpověděl na otázku, strukturu (jasný úvod – jedna pointa – závěr), využití času, přesvědčivost a nasazení, konkrétní/obrazný jazyk a plynulost (zabíhání, výplňová slova).

Dej KRÁTKOU, heslovitou a povzbudivou zpětnou vazbu, kterou může hodnotitel rovnou přečíst nahlas. Vrať POUZE prostý text — žádný Markdown, žádné „#" ani „**". 4–6 krátkých řádků, každý max ~12 slov, s odrážkami pomocí „- ". Začni jedním upřímným kladem (s konkrétním momentem), dej 1–2 konkrétní doporučení a zakonči jednořádkovým povzbuzením.`;
}

function fmt(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function userMessage(b: Body, lang: string): string {
  const en = lang === "en-US";
  const meta: string[] = [];
  if (b.mode === "improv") {
    const topic = (b.topic || "").trim();
    if (topic) meta.push((en ? "Topic / question: " : "Téma / otázka: ") + topic);
  } else {
    if (b.durationSec && b.durationSec > 0) meta.push((en ? "Duration: " : "Délka: ") + fmt(b.durationSec));
    if (b.greenSec && b.redSec) {
      meta.push(
        (en ? "Time limits: green " : "Časové limity: zelená ") +
          fmt(b.greenSec) +
          (en ? ", red " : ", červená ") +
          fmt(b.redSec),
      );
    }
    if (b.wordCount && b.wordCount > 0) meta.push((en ? "Word count: " : "Počet slov: ") + b.wordCount);
    if (b.durationSec && b.durationSec > 30 && b.wordCount && b.wordCount > 0) {
      const wpm = Math.round(b.wordCount / (b.durationSec / 60));
      meta.push((en ? "Pace: ~" : "Tempo: ~") + wpm + (en ? " words/min" : " slov/min"));
    }
    const fillers = (b.fillerSummary || "").trim();
    if (fillers) meta.push((en ? "Filler words detected: " : "Zachycená výplňová slova: ") + fillers);
    const ctx = (b.context || "").trim();
    if (ctx) meta.push((en ? "Context: " : "Kontext: ") + ctx);
    const notes = (b.notes || "").trim();
    if (notes) {
      meta.push(
        (en
          ? "Evaluator's own notes from the room (body language etc. — work these in):\n"
          : "Vlastní poznámky hodnotitele z místnosti (řeč těla apod. — zapracuj je):\n") + notes,
      );
    }
  }
  const head = meta.length ? meta.join("\n") + "\n\n" : "";
  const label =
    b.mode === "improv"
      ? en
        ? "ANSWER TRANSCRIPT:\n"
        : "PŘEPIS ODPOVĚDI:\n"
      : en
        ? "TRANSCRIPT:\n"
        : "PŘEPIS:\n";
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
  const improv = body.mode === "improv";
  const client = new Anthropic();

  try {
    const stream = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: improv ? 700 : 2000,
      stream: true,
      system: improv ? improvSystemPrompt(lang) : systemPrompt(lang),
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
