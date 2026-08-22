import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { getPersona, listPersonas } from "./personas.js";

const PORT = process.env.PORT || 3001;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY not configured");
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/personas", (req, res) => {
  res.json(listPersonas());
});

app.post("/api/chat", async (req, res) => {
  const { personaId, messages } = req.body;

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
      messages: [{ role: "system", content: persona.systemPrompt }, ...history],
    });
    const reply = completion.choices[0]?.message?.content?.trim() || "";
    res.json({ reply });
  } catch (error) {
    console.error("chat completion failed:", error);
    res.status(502).json({ error: "LLM呼び出しに失敗しました" });
  }
});

app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
