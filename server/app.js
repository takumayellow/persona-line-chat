import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import { getPersona, listPersonas } from "./personas.js";

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

/**
 * 環境変数から正の整数を読む。空・非数値・0以下なら既定値。
 * 上限を「0」や書き間違いで無効化できないようにする。
 *
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function positiveIntFromEnv(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * 1回の返信に使わせるトークンの上限。
 *
 * 上限を置かないと、モデルが出せるだけ出した分がそのまま課金になる。
 * このアプリの返信は LINE の吹き出し1つぶんなので 400 で足りる。
 * 日本語は1文字がほぼ1トークン、絵文字と顔文字は1つで数トークン使うので、
 * ペルソナが要求する「2〜4文＋絵文字」が文の途中で切れない幅を取ってある。
 */
const MAX_COMPLETION_TOKENS = positiveIntFromEnv(process.env.MAX_COMPLETION_TOKENS, 400);

/**
 * モデルへ渡す会話の長さ。
 *
 * クライアントは**会話の全部を毎回送ってくる**ので、ここで切らないと
 * 1回の呼び出しの値段が会話の長さに比例して上がり続ける。
 * 直近のやり取りだけあればキャラクターは成立する。
 */
const MAX_HISTORY_MESSAGES = 20;

/** 1発言の長さ。ここを超える分は捨てる。長文を貼られても値段が跳ねない。 */
const MAX_MESSAGE_CHARS = 500;

/** 名前はシステムプロンプトに直接埋まるので、長さと改行を許さない。 */
const MAX_NAME_CHARS = 20;

/**
 * 呼び方は画面が出す3つしかない。これもシステムプロンプトに直接埋まるので、
 * 長さで刈るのではなく、この3つ以外は受けない。
 */
const HONORIFICS = Object.freeze(["くん", "ちゃん", "呼び捨て"]);

/** リクエスト本文の上限。express の既定（100kb）より小さくする。 */
const MAX_BODY_SIZE = "32kb";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY not configured");
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 他所のサイトに埋め込んで、ブラウザ越しに使われるのを防ぐ。
 *
 * クライアントは本番でも開発でも `/api` を**同一オリジン**で叩く
 * （Vercel は静的ファイルと関数を同じホストで出し、Vite は `/api` を :3001 へ流す）。
 * だから既定は「クロスオリジンを一切許さない」でよく、それで誰も困らない。
 * 別オリジンから使いたくなったら `ALLOWED_ORIGINS` にカンマ区切りで並べる。
 *
 * **これはアクセス制御ではない。** CORS はブラウザに応答を読ませないだけで、
 * curl やスクリプトからの直接の呼び出しは素通りする。金額の蓋は OpenAI 側の
 * プロジェクト予算で掛ける（README「支出の上限」）。
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }));
app.use(express.json({ limit: MAX_BODY_SIZE }));

// 公開URLで誰でも叩けるため、一人が連投してAPI課金を溶かすのを防ぐレート制限。
// サーバーレス環境ではインスタンスごとのメモリ内カウントなので厳密ではないが、
// カジュアルな連投・スクリプトからの乱打に対する抑止としては十分。
//
// **これは支出の上限ではない。** インスタンスをまたぐと数え直しになるし、
// IP を変えられれば回数も増える。金額そのものの蓋は OpenAI 側のプロジェクト予算で掛ける
// （README「支出の上限」）。
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "リクエストが多すぎます。しばらくしてからもう一度お試しください。" },
});

/**
 * 名前をシステムプロンプトへ埋められる形に刈り込む。
 * 改行を潰し、囲みのかぎ括弧を落とし、長さで切る。
 * かぎ括弧を残すと `「name」` の囲みから抜け出せてしまう。
 *
 * @param {unknown} value
 * @param {number} maxChars
 * @returns {string}
 */
function clamp(value, maxChars) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[「」『』]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

/**
 * クライアントが送ってきた会話を、モデルへ渡せる形に刈り込む。
 * 直近 MAX_HISTORY_MESSAGES 件だけを、1件 MAX_MESSAGE_CHARS 文字までで残す。
 *
 * @param {unknown} messages
 * @returns {ReadonlyArray<{role: "user"|"assistant", content: string}>}
 */
function toHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m.text === "string")
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text.slice(0, MAX_MESSAGE_CHARS),
    }))
    // 空の発言を先に落としてから数える。後から落とすと、直近20件に空白だけの
    // 発言が混ざったときに実効の履歴が20件より短くなる。
    .filter((m) => m.content.trim().length > 0)
    .slice(-MAX_HISTORY_MESSAGES);
}

app.get("/api/personas", (req, res) => {
  res.json(listPersonas());
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const { personaId, messages, userName, honorific } = req.body ?? {};

  const history = toHistory(messages);
  if (history.length === 0) {
    return res.status(400).json({ error: "messages is required" });
  }

  const persona = getPersona(personaId);

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        {
          role: "system",
          content: persona.systemPrompt(
            clamp(userName, MAX_NAME_CHARS),
            HONORIFICS.includes(honorific) ? honorific : ""
          ),
        },
        ...history,
      ],
    });
    const reply = completion.choices[0]?.message?.content?.trim() || "";
    res.json({ reply });
  } catch (error) {
    console.error("chat completion failed:", error);
    res.status(502).json({ error: "LLM呼び出しに失敗しました" });
  }
});

// 本文が大きすぎる / JSON が壊れているときに、既定のハンドラがスタックを本文に積む。
// サーバー側のファイルパスを返さない。
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "メッセージが長すぎます。" });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "リクエストの形式が正しくありません。" });
  }
  console.error("unhandled error:", error);
  res.status(500).json({ error: "サーバーエラーが発生しました。" });
});

export default app;
