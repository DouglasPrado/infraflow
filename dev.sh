#!/usr/bin/env bash
# Sobe api, worker e web como processos independentes e supervisionados.
#
# Independentes porque, sob o turbo, um serviço que cai derruba os outros dois.
# Supervisionados porque o ambiente às vezes manda SIGTERM em processo de
# desenvolvimento — o supervisor traz de volta em vez de deixar o app fora do ar.
#
#   ./dev.sh          sobe tudo e espera responder
#   ./dev.sh status   diz o que está vivo
#   ./dev.sh stop     derruba tudo, inclusive o supervisor
#   ./dev.sh logs     acompanha os três logs
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p var/log

PIDS=var/log/supervisor.pids

supervise() {
  local nome="$1" dir="$2"; shift 2
  # Relança enquanto o arquivo de pids existir; `stop` o apaga e o laço termina.
  nohup bash -c '
    nome="$1"; dir="$2"; shift 2
    while [ -f "'"$PIDS"'" ]; do
      "$@" >> "var/log/$nome.log" 2>&1
      [ -f "'"$PIDS"'" ] || break
      echo "[supervisor] $nome caiu; subindo de novo em 2s" >> "var/log/$nome.log"
      sleep 2
    done
  ' _ "$nome" "$dir" "$@" >/dev/null 2>&1 &
  echo $! >> "$PIDS"
}

case "${1:-start}" in
  stop)
    [ -f "$PIDS" ] && { xargs kill 2>/dev/null < "$PIDS"; rm -f "$PIDS"; }
    pkill -f "next dev" 2>/dev/null
    pkill -f "experimental-strip-types src/index.ts" 2>/dev/null
    echo "parado"
    ;;

  status)
    for porta in 3000 3333; do
      printf "porta %s: " "$porta"
      lsof -nP -iTCP:"$porta" -sTCP:LISTEN >/dev/null 2>&1 && echo "no ar" || echo "parada"
    done
    pgrep -f "experimental-strip-types src/index.ts" >/dev/null && echo "worker:   no ar" || echo "worker:   parado"
    ;;

  logs)
    tail -f var/log/*.log
    ;;

  *)
    "$0" stop >/dev/null 2>&1
    docker compose up -d >/dev/null 2>&1
    : > "$PIDS"

    # As dependências precisam estar construídas antes de qualquer serviço subir.
    pnpm turbo run build --filter=@infraflow/db --filter=@infraflow/schema \
      --filter=@infraflow/registry --filter=@infraflow/validator \
      --filter=@infraflow/analyzer --filter=@infraflow/compiler \
      --filter=@infraflow/opentofu-generator --filter=@infraflow/load-engine \
      --filter=@infraflow/report-generator >/dev/null 2>&1

    supervise api    apps/api    bash -c 'cd apps/api    && exec node --experimental-strip-types src/index.ts'
    supervise worker apps/worker bash -c 'cd apps/worker && exec node --experimental-strip-types src/index.ts'
    supervise web    apps/web    bash -c 'cd apps/web    && exec pnpm exec next dev'

    echo "subindo… (logs em var/log/)"
    for _ in $(seq 1 90); do
      if curl -sf http://127.0.0.1:3000/login >/dev/null 2>&1 \
        && curl -sf http://127.0.0.1:3333/health >/dev/null 2>&1; then
        echo "web  http://localhost:3000"
        echo "api  http://127.0.0.1:3333"
        exit 0
      fi
      sleep 2
    done
    echo "não subiu em 3 min — veja var/log/" >&2
    exit 1
    ;;
esac
