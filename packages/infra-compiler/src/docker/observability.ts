/**
 * Observabilidade do laboratório (PRD §36, §78).
 *
 * O caminho é o que o §36 desenha: aplicação → OpenTelemetry → coletor →
 * Prometheus. O coletor lê as estatísticas dos containers e **carrega o id do
 * node do canvas como rótulo** — é o que faz a métrica voltar para o grafo em
 * vez de virar número sem dono.
 *
 * O filtro por laboratório não é detalhe: sem ele o coletor exportaria as
 * métricas de tudo que roda na máquina, e um laboratório enxergaria o outro
 * (§52).
 */

export const COLLECTOR_PORT = 8889;
export const PROMETHEUS_PORT = 9090;

/** Rótulo do Prometheus que carrega o id do node do canvas. */
export const NODE_LABEL = "infraflow_node";
export const LAB_LABEL = "infraflow_lab";

export function collectorConfig(labSlug: string): string {
  return `receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 2s
    container_labels_to_metric_labels:
      infraflow.lab: ${LAB_LABEL}
      infraflow.node: ${NODE_LABEL}
    metrics:
      container.cpu.utilization:
        enabled: true

processors:
  # Só o que pertence a este laboratório sai daqui.
  filter/lab:
    metrics:
      datapoint:
        - 'resource.attributes["${LAB_LABEL}"] != "${labSlug}"'

exporters:
  prometheus:
    endpoint: 0.0.0.0:${COLLECTOR_PORT}
    resource_to_telemetry_conversion:
      enabled: true

service:
  telemetry:
    logs:
      level: warn
  pipelines:
    metrics:
      receivers: [docker_stats]
      processors: [filter/lab]
      exporters: [prometheus]
`;
}

export function prometheusConfig(collectorHost: string): string {
  return `global:
  scrape_interval: 2s
  evaluation_interval: 2s

scrape_configs:
  - job_name: lab
    static_configs:
      - targets: ["${collectorHost}:${COLLECTOR_PORT}"]
`;
}
