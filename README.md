# persona-line-chat

LINE風のUIで、キャラクターペルソナ(おじさん / メンヘラ)とチャットできるプロトタイプ。
おじさん構文の語彙は https://took.jp/tools/ojisan の公開JSバンドルをリバースエンジニアリングして抽出したものを、
システムプロンプトのヒントとして利用している(生成自体はLLM)。

## 構成

- `client/` — Vite + React。LINE風チャットUI
- `server/` — Express。`/api/chat` で OpenAI (デフォルト `gpt-4o-mini`) を呼び出す
- `server/personas.js` — ペルソナ定義(システムプロンプト・語彙・アバター)。ここに追加すれば新ペルソナを増やせる

## セットアップ

```bash
npm install
npm --prefix client install
npm --prefix server install
```

`server/.env` に `OPENAI_API_KEY` を設定する(`server/.env.example` 参照)。

## 起動

```bash
npm run dev
```

client: http://localhost:5173 / server: http://localhost:3001（`/api` はViteがプロキシ）
