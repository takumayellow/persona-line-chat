import { useEffect, useRef, useState } from "react";
import "./App.css";
import menheraAvatar from "./assets/menhera-avatar.png";

const AVATAR_IMAGES = { menhera: menheraAvatar };

/**
 * サーバーへ送る会話の長さ。サーバー側の刈り込み（`server/app.js`）と同じ値にしてある。
 *
 * 画面には会話が全部残るが、**送るのは直近ぶんだけ**にする。
 * 全部送っていると、会話が伸びるほど本文が大きくなり、いずれサーバーの
 * 本文上限（32kb）に当たって、その会話が二度と送れなくなる。
 */
const MAX_HISTORY_MESSAGES = 20;

/** 1発言の長さ。これ以上はサーバーが捨てるので、送る前に切る。 */
const MAX_MESSAGE_CHARS = 500;

function formatTime(date) {
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function Avatar({ persona, className }) {
  const image = persona && AVATAR_IMAGES[persona.id];
  if (image) {
    return <img className={className} src={image} alt="" />;
  }
  return <div className={className}>{persona?.avatar || "🧔"}</div>;
}

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem("chatProfile")) || null;
  } catch {
    return null;
  }
}

function ProfileGate({ initial, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [honorific, setHonorific] = useState(initial?.honorific ?? "くん");

  function handleSubmit(e) {
    e.preventDefault();
    onSave({ name: name.trim(), honorific });
  }

  return (
    <div className="phone profile-gate">
      <form className="profile-form" onSubmit={handleSubmit}>
        <h1>はじめに</h1>
        <p>相手があなたを呼ぶときの名前を教えてください。</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名前"
          autoFocus
        />
        <div className="honorific-choices">
          {["くん", "ちゃん", "呼び捨て"].map((h) => (
            <label key={h} className={honorific === h ? "active" : ""}>
              <input
                type="radio"
                name="honorific"
                value={h}
                checked={honorific === h}
                onChange={() => setHonorific(h)}
              />
              {h}
            </label>
          ))}
        </div>
        <button type="submit">はじめる</button>
      </form>
    </div>
  );
}

export default function App() {
  const [personas, setPersonas] = useState([]);
  const [personaId, setPersonaId] = useState("ojisan");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(loadProfile);
  const [editingProfile, setEditingProfile] = useState(false);
  const scrollRef = useRef(null);

  function saveProfile(next) {
    setProfile(next);
    setEditingProfile(false);
    localStorage.setItem("chatProfile", JSON.stringify(next));
  }

  const persona = personas.find((p) => p.id === personaId);

  useEffect(() => {
    let cancelled = false;

    function attempt(retriesLeft) {
      fetch("/api/personas")
        .then((r) => {
          if (!r.ok) throw new Error("bad status");
          return r.json();
        })
        .then((data) => {
          if (cancelled) return;
          setPersonas(data);
          setError("");
        })
        .catch(() => {
          if (cancelled) return;
          if (retriesLeft > 0) {
            setTimeout(() => attempt(retriesLeft - 1), 1000);
          } else {
            setError("ペルソナ一覧の取得に失敗しました");
          }
        });
    }

    attempt(5);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim().slice(0, MAX_MESSAGE_CHARS);
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
        body: JSON.stringify({
          personaId,
          messages: nextMessages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
            role: m.role,
            text: m.text.slice(0, MAX_MESSAGE_CHARS),
          })),
          userName: profile?.name || "",
          honorific: profile?.honorific || "",
        }),
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

  if (!profile || editingProfile) {
    return <ProfileGate initial={profile} onSave={saveProfile} />;
  }

  return (
    <div className="phone">
      <div className="header">
        <Avatar persona={persona} className="avatar" />
        <div className="title">{persona?.label || "おじさん"}</div>
        <button
          type="button"
          className="profile-edit-btn"
          onClick={() => setEditingProfile(true)}
          title="呼び名を変更"
        >
          {profile.name || "名前未設定"}
        </button>
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
            {m.role === "bot" && <Avatar persona={persona} className="bubble-avatar" />}
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
          maxLength={MAX_MESSAGE_CHARS}
          placeholder="メッセージを入力"
        />
        <button type="submit" disabled={sending || !input.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}
