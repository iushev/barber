// Мок на OpenAI Chat Completions API (без зависимости) за smoke тестовете на чата.
// Детерминиран: според последното съобщение на потребителя вика инструментите на
// агента (list_services → get_free_slots → create_booking) и отговаря с текст.
// Поддържа stream: true (SSE) и обикновен JSON отговор.
//
//   node tests/support/mock-openai.mjs   # слуша на :8080 (MOCK_PORT)
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 8080);
let seq = 0;

const textOf = (c) =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : "";

const parseJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

function sofiaDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d);
}

/** Решава следващата стъпка: { tool: {name, args} } или { text }. */
function decide(messages, tools) {
  const toolNames = new Set(tools.map((t) => t.function?.name));
  let lastUser = -1;
  messages.forEach((m, i) => {
    if (m.role === "user") lastUser = i;
  });
  const userText = textOf(messages[lastUser]?.content).toLowerCase();
  const previousUsers = messages.filter((m) => m.role === "user").length - 1;

  // Резултати от инструменти след последното потребителско съобщение.
  const callNames = {};
  const results = [];
  for (const m of messages.slice(lastUser + 1)) {
    if (m.role === "assistant")
      for (const tc of m.tool_calls ?? [])
        callNames[tc.id] = { name: tc.function.name, args: parseJson(tc.function.arguments) };
    if (m.role === "tool")
      results.push({
        ...callNames[m.tool_call_id],
        result: parseJson(textOf(m.content)) ?? textOf(m.content),
      });
  }
  const unwrap = (r) => (Array.isArray(r) ? r[0] : r)?.response ?? (Array.isArray(r) ? r[0] : r);
  const last = results.at(-1);

  if (userText.includes("помниш")) {
    return { text: `Помня ${previousUsers} предишни съобщения от вас.` };
  }

  if (userText.includes("услуги")) {
    if (!last) return { tool: { name: "list_services", args: {} } };
    const services = unwrap(last.result)?.services ?? [];
    return {
      text: `Предлагаме ${services.length} услуги: ${services.map((s) => `${s.name} (${s.price} EUR)`).join(", ")}.`,
    };
  }

  if (userText.includes("запиши")) {
    if (!toolNames.has("create_booking")) return { text: "Няма инструмент за записване." };
    const svcRes = results.find((r) => r.name === "list_services");
    if (!svcRes) return { tool: { name: "list_services", args: {} } };
    const service = unwrap(svcRes.result).services.find((s) => s.barbers.length > 0);
    const barber = service.barbers[0];
    const slotCalls = results.filter((r) => r.name === "get_free_slots");
    const booking = results.find((r) => r.name === "create_booking");
    if (booking) {
      const b = unwrap(booking.result);
      if (b?.booking)
        return {
          text: `Готово! Записах ви за ${b.booking.start}. Запазете линка: ${b.booking.manageUrl}`,
        };
      return { text: `Неуспешно записване: ${b?.error?.message ?? "неизвестна грешка"}` };
    }
    const lastSlots = slotCalls.at(-1);
    const slots = lastSlots ? (unwrap(lastSlots.result)?.slots ?? []) : [];
    if (slots.length > 0) {
      const phone = userText.match(/0\d[\d ]{7,}/)?.[0] ?? "0888 000 111";
      return {
        tool: {
          name: "create_booking",
          args: {
            serviceId: service.id,
            barberId: barber.id,
            start: slots.at(-1).start,
            customerName: "Чат Тестов",
            customerPhone: phone,
          },
        },
      };
    }
    if (slotCalls.length >= 10) return { text: "Няма свободни часове в следващите дни." };
    return {
      tool: {
        name: "get_free_slots",
        args: { serviceId: service.id, barberId: barber.id, date: sofiaDate(slotCalls.length + 1) },
      },
    };
  }

  return { text: "Здравейте! Мога да ви помогна да запазите час. Коя услуга ви интересува?" };
}

function completion(decision, model) {
  const id = `chatcmpl-mock-${++seq}`;
  const created = Math.floor(Date.now() / 1000);
  const message = decision.tool
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call_${seq}`,
            type: "function",
            function: { name: decision.tool.name, arguments: JSON.stringify(decision.tool.args) },
          },
        ],
      }
    : { role: "assistant", content: decision.text };
  return {
    id,
    created,
    model,
    message,
    finish: decision.tool ? "tool_calls" : "stop",
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "gpt-4.1-mini", object: "model" },
          { id: "mock", object: "model" },
        ],
      }),
    );
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({ error: { message: `mock: unsupported ${req.method} ${req.url}` } }),
    );
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = parseJson(raw) ?? {};
    const decision = decide(body.messages ?? [], body.tools ?? []);
    const c = completion(decision, body.model ?? "mock");
    console.log(
      `[mock-openai] ${decision.tool ? `tool → ${decision.tool.name}` : "text"} (stream=${!!body.stream}, msgs=${(body.messages ?? []).length})`,
    );

    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          id: c.id,
          object: "chat.completion",
          created: c.created,
          model: c.model,
          choices: [{ index: 0, message: c.message, finish_reason: c.finish, logprobs: null }],
          usage: c.usage,
        }),
      );
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (choices, extra = {}) =>
      res.write(
        `data: ${JSON.stringify({ id: c.id, object: "chat.completion.chunk", created: c.created, model: c.model, choices, ...extra })}\n\n`,
      );
    send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
    if (c.message.tool_calls) {
      const tc = c.message.tool_calls[0];
      send([
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: tc.id,
                type: "function",
                function: { name: tc.function.name, arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ]);
      send([
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: tc.function.arguments } }] },
          finish_reason: null,
        },
      ]);
    } else {
      // Текстът на части, за да се види стриймингът.
      for (const part of c.message.content.match(/.{1,12}/gsu) ?? []) {
        send([{ index: 0, delta: { content: part }, finish_reason: null }]);
      }
    }
    send([{ index: 0, delta: {}, finish_reason: c.finish }]);
    send([], { usage: c.usage });
    res.end("data: [DONE]\n\n");
  });
});

server.listen(PORT, () => console.log(`[mock-openai] слуша на :${PORT}`));
