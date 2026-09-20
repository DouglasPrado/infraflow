/**
 * Aplicação que o laboratório implanta nos nodes de compute (PRD §76).
 *
 * Não é um "hello world" parado: a cada requisição ela **exercita cada
 * dependência declarada no canvas** — `PING` no Redis, conexão TCP no banco,
 * `GET` no que fala HTTP. É isso que faz a carga do §77 percorrer a topologia
 * desenhada em vez de bater só na borda, e o que faz a métrica do §78 do banco
 * subir quando o teste aperta.
 *
 * Sem dependência externa e sem template literal: o texto entra num heredoc do
 * HCL, onde `${` seria interpolação.
 */
export const SYNTHETIC_APP = `"use strict";
const http = require("node:http");
const net = require("node:net");

const PORT = Number(process.env.PORT || 8080);
const SERVICE = process.env.SERVICE || "app";
const TIMEOUT = Number(process.env.DEP_TIMEOUT_MS || 2000);
const DEPS = JSON.parse(process.env.DEPS || "[]");

function tcpProbe(dep, payload, expected) {
  return new Promise(function (resolve) {
    const started = Date.now();
    const socket = net.connect({ host: dep.host, port: dep.port });
    let settled = false;

    function done(ok, detail) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ name: dep.name, ok: ok, ms: Date.now() - started, detail: detail });
    }

    socket.setTimeout(TIMEOUT);
    socket.on("timeout", function () { done(false, "timeout"); });
    socket.on("error", function (error) { done(false, error.code || "error"); });
    socket.on("connect", function () {
      if (!payload) done(true, "connected");
      else socket.write(payload);
    });
    socket.on("data", function (chunk) {
      const text = chunk.toString("utf8");
      done(expected ? text.indexOf(expected) === 0 : true, text.trim().slice(0, 24));
    });
  });
}

function httpProbe(dep) {
  return new Promise(function (resolve) {
    const started = Date.now();
    const request = http.get(
      { host: dep.host, port: dep.port, path: dep.path || "/", timeout: TIMEOUT },
      function (response) {
        response.resume();
        resolve({
          name: dep.name,
          ok: response.statusCode < 500,
          ms: Date.now() - started,
          detail: String(response.statusCode),
        });
      },
    );
    request.on("timeout", function () { request.destroy(); });
    request.on("error", function (error) {
      resolve({ name: dep.name, ok: false, ms: Date.now() - started, detail: error.code || "error" });
    });
  });
}

function exercise(dep) {
  if (dep.kind === "redis") return tcpProbe(dep, "PING\\r\\n", "+PONG");
  if (dep.kind === "http") return httpProbe(dep);
  return tcpProbe(dep, null, null);
}

const server = http.createServer(function (request, response) {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
    return;
  }

  Promise.all(DEPS.map(exercise)).then(function (checks) {
    const ok = checks.every(function (check) { return check.ok; });
    response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: ok, service: SERVICE, checks: checks }));
  });
});

server.keepAliveTimeout = 65000;
server.listen(PORT);
`;

/** Configuração do proxy para os nodes de rede do canvas. */
export function nginxConf(upstreams: { host: string; port: number }[]): string {
  if (upstreams.length === 0) {
    return `worker_processes auto;
events { worker_connections 4096; }
http {
  access_log off;
  server {
    listen 80;
    location / { return 200 "sem destino no canvas\\n"; }
  }
}
`;
  }

  const servers = upstreams
    .map((upstream) => `    server ${upstream.host}:${upstream.port};`)
    .join("\n");

  return `worker_processes auto;
events { worker_connections 4096; }
http {
  access_log off;

  upstream backend {
${servers}
    keepalive 64;
  }

  server {
    listen 80;

    location /healthz {
      return 200 "ok\\n";
    }

    location / {
      proxy_pass http://backend;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
    }
  }
}
`;
}
