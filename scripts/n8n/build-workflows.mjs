#!/usr/bin/env node
/**
 * Генерира n8n workflow JSON файловете от тази дефиниция + системния промпт:
 *   n8n/prompts/agent-system-prompt.md → n8n/workflows/booking-agent.json
 *                                      → n8n/workflows/chat-purge.json
 *
 *   npm run n8n:build          # пренаписва файловете
 *   npm run n8n:build -- --check  # CI: грешка, ако файловете не са синхронизирани
 *
 * Версиите и имената на параметрите са проверени срещу n8n 2.47.3 (виж DECISIONS.md).
 * Credentials се реферират по фиксирани ID-та; самите тайни НЕ са тук — създават се
 * със scripts/n8n/setup.sh.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const prompt = readFileSync(path.join(root, "n8n/prompts/agent-system-prompt.md"), "utf8").trim();

export const CREDENTIALS = {
  openAi: { id: "BarberOpenAi0001", name: "Barber · OpenAI" },
  agentApi: { id: "BarberAgentApi01", name: "Barber · Agent API (Bearer)" },
  chatAuth: { id: "BarberChatAuth01", name: "Barber · Chat Basic Auth" },
  n8nDb: { id: "BarberN8nPg00001", name: "Barber · n8n DB (chat memory)" },
};

const TRIGGER = "When chat message received";
const AGENT_API = "http://app:3000/api/agent/v1";
const SESSION = `$('${TRIGGER}').first().json.sessionId`;

const fromAI = {
  serviceId: "$fromAI('serviceId', 'ID на услугата — полето id от list_services', 'string')",
  barberId:
    "$fromAI('barberId', 'ID на бръснаря — полето id от barbers на услугата в list_services', 'string')",
  date: "$fromAI('date', 'Дата във формат YYYY-MM-DD (часова зона Europe/Sofia)', 'string')",
  start:
    "$fromAI('start', 'Началото на избрания слот точно както е в полето start от get_free_slots, напр. 2026-11-12T10:00:00+02:00', 'string')",
  customerName: "$fromAI('customerName', 'Име на клиента', 'string')",
  customerPhone: "$fromAI('customerPhone', 'Телефон на клиента, както го е написал', 'string')",
};

/** Общи настройки за HTTP Request Tool към Agent API. */
function agentTool({
  id,
  name,
  position,
  description,
  method = "GET",
  url,
  query,
  headers,
  body,
  fields,
}) {
  return {
    id,
    name,
    type: "n8n-nodes-base.httpRequestTool",
    typeVersion: 4.2,
    position,
    parameters: {
      toolDescription: description,
      method,
      url: `${AGENT_API}${url}`,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      ...(query && {
        sendQuery: true,
        queryParameters: {
          parameters: Object.entries(query).map(([n, v]) => ({ name: n, value: `={{ ${v} }}` })),
        },
      }),
      ...(headers && {
        sendHeaders: true,
        headerParameters: {
          parameters: Object.entries(headers).map(([n, v]) => ({ name: n, value: v })),
        },
      }),
      ...(body && {
        sendBody: true,
        contentType: "json",
        specifyBody: "keypair",
        bodyParameters: {
          parameters: Object.entries(body).map(([n, v]) => ({ name: n, value: `={{ ${v} }}` })),
        },
      }),
      options: {
        timeout: 15000,
        // 4xx отговорите (422/409) съдържат полезни съобщения за агента → не ги превръщаме в грешка.
        response: { response: { neverError: true, responseFormat: "json" } },
      },
      // Агентът вижда само нужните полета.
      optimizeResponse: true,
      responseType: "json",
      fieldsToInclude: "selected",
      fields,
    },
    credentials: { httpHeaderAuth: CREDENTIALS.agentApi },
  };
}

const bookingAgent = {
  id: "BarberAgent00001",
  name: "Barber · Booking agent",
  active: false,
  settings: {
    executionOrder: "v1",
    saveDataSuccessExecution: "none",
    saveDataErrorExecution: "all",
    saveManualExecutions: false,
    saveExecutionProgress: false,
    callerPolicy: "workflowsFromSameOwner",
  },
  nodes: [
    {
      id: "6f1d1c3e-6c5e-4a3c-9a0e-1a2b3c4d5e01",
      name: TRIGGER,
      type: "@n8n/n8n-nodes-langchain.chatTrigger",
      typeVersion: 1.5,
      position: [0, 0],
      // Фиксиран webhookId → URL: http://n8n:5678/webhook/booking-agent/chat
      webhookId: "booking-agent",
      parameters: {
        public: true,
        mode: "webhook",
        authentication: "basicAuth",
        // autoSaveHighlightedData: false → текстът на съобщението не се копира в метаданните на изпълнението.
        options: {
          responseMode: "streaming",
          loadPreviousSession: "notSupported",
          autoSaveHighlightedData: false,
        },
      },
      credentials: { httpBasicAuth: CREDENTIALS.chatAuth },
    },
    {
      id: "6f1d1c3e-6c5e-4a3c-9a0e-1a2b3c4d5e02",
      name: "AI Agent",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 3.1,
      position: [320, 0],
      parameters: {
        promptType: "auto",
        text: "={{ $json.chatInput }}",
        options: {
          systemMessage: `=${prompt}`,
          maxIterations: 8,
          enableStreaming: true,
          autoSaveHighlightedData: false,
        },
      },
    },
    {
      id: "6f1d1c3e-6c5e-4a3c-9a0e-1a2b3c4d5e03",
      name: "OpenAI Chat Model",
      type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      typeVersion: 1.3,
      position: [120, 260],
      parameters: {
        // Моделът се подменя от scripts/n8n/setup.sh според OPENAI_MODEL.
        model: { __rl: true, mode: "id", value: "gpt-4.1-mini" },
        // Chat Completions API: поддържа temperature и всеки OpenAI-съвместим endpoint.
        responsesApiEnabled: false,
        options: { temperature: 0.2, maxTokens: 700, timeout: 30000, maxRetries: 1 },
      },
      credentials: { openAiApi: CREDENTIALS.openAi },
    },
    {
      id: "6f1d1c3e-6c5e-4a3c-9a0e-1a2b3c4d5e04",
      name: "Postgres Chat Memory",
      type: "@n8n/n8n-nodes-langchain.memoryPostgresChat",
      typeVersion: 1.4,
      position: [300, 260],
      parameters: {
        sessionIdType: "fromInput",
        sessionKey: "={{ $json.sessionId }}",
        tableName: "n8n_chat_histories",
        // Последните N двойки съобщения → ограничена история и разход.
        contextWindowLength: 8,
      },
      credentials: { postgres: CREDENTIALS.n8nDb },
    },
    agentTool({
      id: "6f1d1c3e-6c5e-4a3c-9a0e-1a2b3c4d5e05",
      name: "list_services",
      position: [480, 260],
      description:
        "Списък с услугите на бръснарницата: id, име, описание, продължителност (мин), цена и валута, и кои бръснари (id, име) извършват всяка услуга. Използвай го в началото на всяко записване и когато клиентът пита за услуги или цени.",
      url: "/services",
      fields: "currency,services,error",
    }),
    agentTool({
      id: "6f1d1c3e-6c5e-4a3c-9a0e-1a2b3c4d5e06",
      name: "get_free_slots",
      position: [640, 260],
      description:
        "Свободни часове за дадена услуга, бръснар и дата. Връща slots: start/end (ISO с часова зона) и label (HH:MM). Празен списък означава, че няма свободни часове за деня. Използвай го винаги преди да предложиш час.",
      url: "/slots",
      query: { serviceId: fromAI.serviceId, barberId: fromAI.barberId, date: fromAI.date },
      fields: "date,slots,error",
    }),
    agentTool({
      id: "6f1d1c3e-6c5e-4a3c-9a0e-1a2b3c4d5e07",
      name: "create_booking",
      position: [800, 260],
      description:
        "Създава резервация. Извиквай САМО след като си обобщил избора на клиента и той изрично е потвърдил с „да“. Връща booking с manageUrl (линк за управление) или error (напр. slot_taken с alternatives).",
      method: "POST",
      url: "/bookings",
      headers: {
        // Повторно извикване със същия ключ връща същата резервация (без дубликат).
        "Idempotency-Key": `={{ ${SESSION} }}:{{ ${fromAI.start} }}`,
        "X-Chat-Session-Id": `={{ ${SESSION} }}`,
      },
      body: {
        serviceId: fromAI.serviceId,
        barberId: fromAI.barberId,
        start: fromAI.start,
        customerName: fromAI.customerName,
        customerPhone: fromAI.customerPhone,
      },
      fields: "booking,error",
    }),
  ],
  connections: {
    [TRIGGER]: { main: [[{ node: "AI Agent", type: "main", index: 0 }]] },
    "OpenAI Chat Model": {
      ai_languageModel: [[{ node: "AI Agent", type: "ai_languageModel", index: 0 }]],
    },
    "Postgres Chat Memory": { ai_memory: [[{ node: "AI Agent", type: "ai_memory", index: 0 }]] },
    list_services: { ai_tool: [[{ node: "AI Agent", type: "ai_tool", index: 0 }]] },
    get_free_slots: { ai_tool: [[{ node: "AI Agent", type: "ai_tool", index: 0 }]] },
    create_booking: { ai_tool: [[{ node: "AI Agent", type: "ai_tool", index: 0 }]] },
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};

/** Служебен workflow: изтрива чат историята по sessionId (GDPR), вика се от app. */
const chatPurge = {
  id: "BarberPurge00001",
  name: "Barber · Chat history purge (GDPR)",
  active: false,
  settings: {
    executionOrder: "v1",
    saveDataSuccessExecution: "none",
    saveDataErrorExecution: "all",
    saveManualExecutions: false,
  },
  nodes: [
    {
      id: "7a2e2d4f-7d6f-4b4d-8b1f-2b3c4d5e6f01",
      name: "Purge request",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2.2,
      position: [0, 0],
      webhookId: "chat-purge",
      parameters: {
        httpMethod: "POST",
        path: "chat-purge",
        authentication: "basicAuth",
        responseMode: "lastNode",
        responseData: "firstEntryJson",
        options: {},
      },
      credentials: { httpBasicAuth: CREDENTIALS.chatAuth },
    },
    {
      id: "7a2e2d4f-7d6f-4b4d-8b1f-2b3c4d5e6f02",
      name: "Delete chat history",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [260, 0],
      parameters: {
        operation: "executeQuery",
        // Параметризирано; sessionId-тата се филтрират до [A-Za-z0-9_-] и се съединяват с „|“
        // (n8n разделя queryReplacement по запетаи на отделни параметри).
        // Postgres Chat Memory v1.4 пази сесията като "<sessionId>__<име на възела>" → трием
        // и точното съвпадение, и всички „scoped“ варианти (без LIKE: sessionId може да има „_“).
        query:
          "WITH ids AS (SELECT unnest(string_to_array($1, '|')) AS s), d AS (DELETE FROM n8n_chat_histories h USING ids WHERE h.session_id = ids.s OR left(h.session_id, length(ids.s) + 2) = ids.s || '__' RETURNING 1) SELECT count(*)::int AS deleted FROM d",
        options: {
          queryReplacement:
            "={{ ($json.body.sessionIds || []).filter(s => /^[A-Za-z0-9_-]{8,128}$/.test(s)).join('|') }}",
        },
      },
      credentials: { postgres: CREDENTIALS.n8nDb },
    },
  ],
  connections: {
    "Purge request": { main: [[{ node: "Delete chat history", type: "main", index: 0 }]] },
  },
  pinData: {},
};

const outputs = {
  "n8n/workflows/booking-agent.json": bookingAgent,
  "n8n/workflows/chat-purge.json": chatPurge,
};

const check = process.argv.includes("--check");
let stale = false;
for (const [rel, wf] of Object.entries(outputs)) {
  const file = path.join(root, rel);
  const content = `${JSON.stringify(wf, null, 2)}\n`;
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    // няма файл
  }
  if (current === content) continue;
  if (check) {
    console.error(`[n8n:build] ${rel} не е синхронизиран — пуснете npm run n8n:build`);
    stale = true;
  } else {
    writeFileSync(file, content);
    console.log(`[n8n:build] записан ${rel}`);
  }
}
if (stale) process.exit(1);
