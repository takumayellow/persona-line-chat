import { useEffect, useRef, useState } from "react";
import "./App.css";

function formatTime(date) {
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [personas, setPersonas] = useState([]);
  const [personaId, setPersonaId] = useState("ojisan");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  const persona = personas.find((p) => p.id === personaId);

  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then(setPersonas)
      .catch(() => setError("ペルソナ一覧の取得に失敗しました"));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMessage = { role: "user", text, at: new Date() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId, messages: nextMessages }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "bot", text: data.reply, at: new Date() }]);
    } catch {
      setError("返信の取得に失敗しました。サーバーが起動しているか確認してください。");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="phone">
      <div className="header">
        <div className="avatar">{persona?.avatar || "🧔"}</div>
        <div className="title">{persona?.label || "おじさん"}</div>
        <select
          className="persona-select"
          value={personaId}
          onChange={(e) => {
            setPersonaId(e.target.value);
            setMessages([]);
          }}
        >
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`row ${m.role}`}>
            {m.role === "bot" && <div className="bubble-avatar">{persona?.avatar || "🧔"}</div>}
            <span className="meta">{formatTime(m.at)}</span>
            <div className="bubble">{m.text}</div>
          </div>
        ))}
        {sending && (
          <div className="row bot typing">
            <div className="bubble-avatar">{persona?.avatar || "🧔"}</div>
            <div className="bubble">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力"
        />
        <button type="submit" disabled={sending || !input.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}
