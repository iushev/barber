"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Чат за записване. Говори само с POST /api/chat (никога директно с n8n).
 * Разговорът се пази в sessionStorage на таба; „Нов разговор“ изтрива историята и в n8n.
 */
type Msg = { role: "user" | "assistant"; text: string; error?: boolean };

const STORAGE_KEY = "barber-chat-v1";
const MAX_LENGTH = 1000;
const GREETING: Msg = {
  role: "assistant",
  text: "Здравейте! Аз съм асистентът за записване. Каква услуга ви интересува и за кога?",
};

function load(): Msg[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Msg[]) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : [GREETING];
  } catch {
    return [GREETING];
  }
}

/**
 * Текст → React възли; линкове правим САМО към нашия сайт (напр. линка за управление),
 * за да не може инжектиран в LLM отговор чужд линк да стане кликаем.
 */
function renderText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(https?:\/\/[^\s<>"]+|\/book\b)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/[.,;:!?)»“"]+$/, "");
    const start = m.index ?? 0;
    out.push(text.slice(last, start));
    let href: string | null = null;
    try {
      const u = new URL(raw, window.location.origin);
      if (u.origin === window.location.origin) href = u.pathname + u.search;
    } catch {
      href = null;
    }
    out.push(
      href ? (
        <a key={start} href={href} className="text-brass break-all underline">
          {raw}
        </a>
      ) : (
        raw
      ),
    );
    last = start + raw.length;
  }
  out.push(text.slice(last));
  return out;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const restored = useRef(false);

  const restore = useCallback(() => {
    if (restored.current) return;
    restored.current = true;
    setMessages(load());
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      // няма достъп до storage — продължаваме без запазване
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, typing]);

  function openChat() {
    restore();
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  function closeChat() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setTyping(true);
    setMessages((m) => [...m, { role: "user", text }]);

    // Ъпдейтърите на state се изпълняват по ред → първият фрагмент създава съобщението,
    // следващите се добавят към него. Не зависят от променливи, четени по-късно.
    let started = false;
    const onDelta = (chunk: string) => {
      if (!started) {
        started = true;
        setMessages((m) => [...m, { role: "assistant", text: chunk }]);
      } else {
        setMessages((m) => {
          const last = m.at(-1)!;
          return [...m.slice(0, -1), { ...last, text: last.text + chunk }];
        });
      }
    };
    const onError = (message: string) => {
      started = false;
      setMessages((m) => [...m, { role: "assistant", text: message, error: true }]);
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        onError(`${body?.error?.message ?? "Възникна грешка. Опитайте отново."} Формата: /book`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as { type: string; text?: string; message?: string };
          if (evt.type === "delta" && evt.text) {
            setTyping(false);
            onDelta(evt.text);
          } else if (evt.type === "error") {
            setTyping(false);
            onError(`${evt.message ?? "Възникна грешка."} Формата: /book`);
          }
        }
      }
    } catch {
      onError("Връзката прекъсна. Опитайте отново или използвайте формата: /book");
    } finally {
      setTyping(false);
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function reset() {
    await fetch("/api/chat", { method: "DELETE" }).catch(() => undefined);
    setMessages([GREETING]);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // игнорираме
    }
    inputRef.current?.focus();
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="chat-title"
          onKeyDown={(e) => e.key === "Escape" && closeChat()}
          className="border-bone/15 bg-coal flex h-[min(34rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border shadow-2xl"
        >
          <header className="border-bone/10 flex items-center gap-2 border-b px-4 py-3">
            <h2 id="chat-title" className="font-display text-lg tracking-wide uppercase">
              Асистент за записване
            </h2>
            <button
              type="button"
              onClick={reset}
              className="text-bone/60 hover:text-brass ml-auto text-xs"
            >
              Нов разговор
            </button>
            <button
              type="button"
              onClick={closeChat}
              aria-label="Затвори чата"
              className="text-bone/60 hover:text-bone px-1 text-xl leading-none"
            >
              ×
            </button>
          </header>

          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <p
                  className={`max-w-[85%] rounded-md px-3 py-2 whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-brass text-ink"
                      : m.error
                        ? "border border-red-400/40 bg-red-950/40"
                        : "bg-char text-bone"
                  }`}
                >
                  <span className="sr-only">{m.role === "user" ? "Вие: " : "Асистент: "}</span>
                  {m.role === "assistant" ? renderText(m.text) : m.text}
                </p>
              </div>
            ))}
            {typing && (
              <p className="text-bone/60 text-xs italic" role="status">
                пише…
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="border-bone/10 border-t p-3"
          >
            <div className="flex items-end gap-2">
              <label htmlFor="chat-input" className="sr-only">
                Вашето съобщение
              </label>
              <textarea
                id="chat-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_LENGTH))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                maxLength={MAX_LENGTH}
                placeholder="Напр. „Подстригване утре следобед“"
                className="border-bone/20 bg-ink focus:border-brass flex-1 resize-none rounded-sm border px-3 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="bg-brass text-ink rounded-sm px-4 py-2 text-sm font-semibold uppercase disabled:opacity-50"
              >
                Изпрати
              </button>
            </div>
            <p className="text-bone/60 mt-2 text-[11px] leading-snug">
              Не споделяйте други лични данни освен име и телефон. Съобщенията се обработват от
              OpenAI.{" "}
              <Link href="/privacy" className="underline">
                Поверителност
              </Link>
            </p>
          </form>
        </section>
      )}

      <button
        ref={toggleRef}
        type="button"
        onClick={() => (open ? closeChat() : openChat())}
        aria-expanded={open}
        aria-label={open ? "Затвори чата" : "Отвори чат за записване"}
        className="bg-brass text-ink hover:bg-bone focus-visible:outline-bone flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold tracking-wide uppercase shadow-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
        </svg>
        {open ? "Затвори" : "Чат"}
      </button>
    </div>
  );
}
