# 🎤 Hodnotitel projevů — Toastmasters

Webová appka (Next.js), která **poslouchá projev**, **přepíše ho** a pomocí Claude (Anthropic) ti připraví
**podklad pro hodnocení** — co vypíchnout, co zlepšit, zapamatovatelné momenty. Ty se pak můžeš soustředit
na řeč těla a přednes, hodnocení máš nachystané ke čtení.

- Živý přepis běží v prohlížeči (Web Speech API, **funguje v Chrome / Edge**).
- Časomíra se signálními světly (🟢/🟡/🔴) jako na Toastmasters.
- Počítadlo slov, slov/min a výplňových slov („ehm“, „prostě“…).
- Hodnocení generuje **server** (API route) — API klíč je bezpečně v env proměnné, **ne v prohlížeči**.
- Čeština i angličtina (přepínač nahoře).

> AI slyší jen zvuk — gesta, oční kontakt a řeč těla posuzuješ ty.

## Lokální spuštění

```bash
npm install
cp .env.local.example .env.local   # a doplň ANTHROPIC_API_KEY
npm run dev
```

Otevři <http://localhost:3000> (nejlépe v Chrome). Při prvním nahrávání povol mikrofon.

## Nasazení na Vercel

1. Nahraj projekt na GitHub.
2. Na [vercel.com](https://vercel.com) → **Add New… → Project** → vyber repozitář.
3. V **Settings → Environment Variables** přidej:
   - `ANTHROPIC_API_KEY` = tvůj klíč (`sk-ant-…`)
4. **Deploy.** Hotovo.

Nebo přes CLI:

```bash
npm i -g vercel
vercel            # první deploy
vercel env add ANTHROPIC_API_KEY
vercel --prod
```

## Jak to používat

1. Klikni **Spustit nahrávání** a nech řečníka mluvit (sleduj časomíru).
2. Po projevu klikni **Stop & vyhodnotit** — hodnocení se začne streamovat napravo.
3. Přepis můžeš kdykoli ručně upravit nebo vložit vlastní text a dát **Vyhodnotit přepis**.

## Použité technologie

- Next.js (App Router) + React + TypeScript
- Web Speech API (přepis v prohlížeči)
- Anthropic SDK, model `claude-opus-4-8` (streamované hodnocení ze serveru)
