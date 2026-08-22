import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import { getPersona, listPersonas } from "./personas.js";

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY not configured");
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

// 公開URLで誰でも叩けるため、一人が連投してAPI課金を溶かすのを防ぐレート制限。
// サーバーレス環境ではインスタンスごとのメモリ内カウントなので厳密ではないが、
// カジュアルな連投・スクリプトからの乱打に対する抑止としては十分。
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "リクエストが多すぎます。しばらくしてからもう一度お試しください。" },
});

app.get("/api/personas", (req, res) => {
  res.json(listPersonas());
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const { personaId, messages, userName, honorific } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages is required" });
  }

  const persona = getPersona(personaId);
  const history = messages
    .filter((m) => m && typeof m.text === "string")
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: persona.systemPrompt(
            typeof userName === "string" ? userName.trim() : "",
            typeof honorific === "string" ? honorific : ""
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

export default app;
