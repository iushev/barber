// Предварително зареждане (node --import) пред Next.js standalone server.js.
//
// Проблем: Next.js задава `x-forwarded-for` от сокета само ако хедърът ЛИПСВА
// (`??=`). Без reverse proxy клиентът може да изпрати фалшив X-Forwarded-For и да
// заобиколи rate limit-а по IP. Тук нормализираме хедърите преди Next.js да ги види:
//
//  - TRUST_PROXY=false (по подразбиране): всички X-Forwarded-*/Forwarded/X-Real-IP от
//    клиента се изтриват; X-Forwarded-For = реалният адрес на сокета.
//  - TRUST_PROXY=true: пред приложението има доверен TLS терминатор/прокси; към веригата
//    се добавя адресът на сокета (на проксито). Клиентският IP е предпоследният елемент
//    (виж src/server/http.ts → clientIp).
import http from "node:http";

const trustProxy = ["true", "1", "yes"].includes((process.env.TRUST_PROXY ?? "").toLowerCase());
const SPOOFABLE = [
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "forwarded",
  "x-real-ip",
];

const originalEmit = http.Server.prototype.emit;

http.Server.prototype.emit = function patchedEmit(event, ...args) {
  if (event === "request") {
    const req = args[0];
    if (req && req.socket && req.headers) {
      const remote = req.socket.remoteAddress ?? "";
      if (trustProxy) {
        const prior = req.headers["x-forwarded-for"];
        req.headers["x-forwarded-for"] = prior ? `${prior}, ${remote}` : remote;
      } else {
        for (const h of SPOOFABLE) delete req.headers[h];
        req.headers["x-forwarded-for"] = remote;
      }
    }
  }
  return originalEmit.call(this, event, ...args);
};
