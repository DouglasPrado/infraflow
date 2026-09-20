"use client";

import { Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { InfraNode, LoadProfileType, WorkloadEndpoint } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspace-store";
import { Field, FieldGroup } from "./property-field";

const PROFILE_TYPES: LoadProfileType[] = [
  "Smoke",
  "Constant",
  "Ramp",
  "Capacity",
  "Spike",
  "Stress",
  "Soak",
];

const METHODS: WorkloadEndpoint["method"][] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** PRD §16–§19, §60 — configuração do Load Generator. Dados mockados. */
export function LoadGeneratorProperties({
  node,
}: {
  node: Extract<InfraNode, { type: "loadGenerator" }>;
}) {
  const update = useWorkspaceStore((state) => state.updateLoadGenerator);
  const renameNode = useWorkspaceStore((state) => state.renameNode);
  const { target, endpoints, profile, slo } = node.data;

  const totalWeight = endpoints.reduce((sum, endpoint) => sum + endpoint.weight, 0);

  const patchEndpoint = (id: string, patch: Partial<WorkloadEndpoint>) =>
    update(node.id, {
      endpoints: endpoints.map((endpoint) =>
        endpoint.id === id ? { ...endpoint, ...patch } : endpoint,
      ),
    });

  return (
    <div className="space-y-5 p-3">
      <div className="flex items-start gap-2">
        <Zap className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} fill="currentColor" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">Load Generator</h2>
          <p className="text-[11px] text-muted-foreground">Origem do teste de carga</p>
        </div>
      </div>

      <Field label="Name">
        <Input
          value={node.data.name}
          onChange={(event) => renameNode(node.id, event.target.value)}
          className="h-8 text-sm"
        />
      </Field>

      <Separator />

      <FieldGroup title="Target">
        <Field label="Protocol">
          <Select
            value={target.protocol}
            onValueChange={(value) => update(node.id, { target: { ...target, protocol: value } })}
          >
            <SelectTrigger size="sm" className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HTTPS">HTTPS</SelectItem>
              <SelectItem value="HTTP">HTTP</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Base URL">
          <Input
            value={target.baseUrl}
            onChange={(event) => update(node.id, { target: { ...target, baseUrl: event.target.value } })}
            placeholder="https://api.example.com"
            className="h-8 font-mono text-sm"
          />
        </Field>

        <Field label="Headers">
          <Input
            value={target.headers}
            onChange={(event) => update(node.id, { target: { ...target, headers: event.target.value } })}
            className="h-8 font-mono text-sm"
          />
        </Field>

        <Field label="Authentication">
          <Input
            value={target.authentication}
            onChange={(event) =>
              update(node.id, { target: { ...target, authentication: event.target.value } })
            }
            className="h-8 text-sm"
          />
        </Field>

        <Field label="Timeout">
          <div className="relative">
            <Input
              type="number"
              value={target.timeoutMs}
              min={100}
              step={100}
              onChange={(event) =>
                update(node.id, { target: { ...target, timeoutMs: Number(event.target.value) } })
              }
              className="h-8 pr-10 font-mono text-sm tabular-nums"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
              ms
            </span>
          </div>
        </Field>
      </FieldGroup>

      <Separator />

      <FieldGroup title="Workload">
        <div className="space-y-1.5">
          {endpoints.map((endpoint) => (
            <div key={endpoint.id} className="flex items-center gap-1.5">
              <Select
                value={endpoint.method}
                onValueChange={(value) =>
                  patchEndpoint(endpoint.id, { method: value as WorkloadEndpoint["method"] })
                }
              >
                <SelectTrigger size="sm" className="h-8 w-[66px] px-2 font-mono text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((method) => (
                    <SelectItem key={method} value={method} className="font-mono text-xs">
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={endpoint.path}
                onChange={(event) => patchEndpoint(endpoint.id, { path: event.target.value })}
                className="h-8 flex-1 px-2 font-mono text-[11px]"
              />

              <div className="relative w-[55px] shrink-0">
                <Input
                  type="number"
                  value={endpoint.weight}
                  min={0}
                  max={100}
                  onChange={(event) => patchEndpoint(endpoint.id, { weight: Number(event.target.value) })}
                  className="h-8 px-2 pr-4 font-mono text-[11px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                  %
                </span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground"
                onClick={() =>
                  update(node.id, { endpoints: endpoints.filter((item) => item.id !== endpoint.id) })
                }
              >
                <Trash2 className="size-3.5" />
                <span className="sr-only">Remover endpoint</span>
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() =>
              update(node.id, {
                endpoints: [
                  ...endpoints,
                  {
                    id: `ep-${Date.now().toString(36)}`,
                    method: "GET",
                    path: "/",
                    weight: 0,
                  },
                ],
              })
            }
          >
            <Plus className="size-3.5" />
            Endpoint
          </Button>
          <span
            className={
              totalWeight === 100
                ? "font-mono text-[11px] tabular-nums text-muted-foreground"
                : "font-mono text-[11px] tabular-nums text-state-warning"
            }
          >
            {totalWeight}%
          </span>
        </div>
      </FieldGroup>

      <Separator />

      <FieldGroup title="Load Profile">
        <Field label="Profile">
          <Select
            value={profile.type}
            onValueChange={(value) =>
              update(node.id, { profile: { ...profile, type: value as LoadProfileType } })
            }
          >
            <SelectTrigger size="sm" className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROFILE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Start">
            <Input
              type="number"
              value={profile.startRps}
              min={1}
              onChange={(event) =>
                update(node.id, { profile: { ...profile, startRps: Number(event.target.value) } })
              }
              className="h-8 font-mono text-sm tabular-nums"
            />
          </Field>
          <Field label="Increment">
            <Input
              type="number"
              value={profile.incrementRps}
              min={1}
              onChange={(event) =>
                update(node.id, { profile: { ...profile, incrementRps: Number(event.target.value) } })
              }
              className="h-8 font-mono text-sm tabular-nums"
            />
          </Field>
          <Field label="Interval">
            <div className="relative">
              <Input
                type="number"
                value={profile.intervalSeconds}
                min={1}
                onChange={(event) =>
                  update(node.id, {
                    profile: { ...profile, intervalSeconds: Number(event.target.value) },
                  })
                }
                className="h-8 pr-6 font-mono text-sm tabular-nums"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                s
              </span>
            </div>
          </Field>
          <Field label="Maximum">
            <Input
              type="number"
              value={profile.maxRps}
              min={1}
              onChange={(event) =>
                update(node.id, { profile: { ...profile, maxRps: Number(event.target.value) } })
              }
              className="h-8 font-mono text-sm tabular-nums"
            />
          </Field>
        </div>
      </FieldGroup>

      <Separator />

      <FieldGroup title="SLO">
        <div className="grid grid-cols-2 gap-2">
          <Field label="p95">
            <div className="relative">
              <Input
                type="number"
                value={slo.p95Ms}
                min={1}
                onChange={(event) => update(node.id, { slo: { ...slo, p95Ms: Number(event.target.value) } })}
                className="h-8 pr-9 font-mono text-sm tabular-nums"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                ms
              </span>
            </div>
          </Field>
          <Field label="p99">
            <div className="relative">
              <Input
                type="number"
                value={slo.p99Ms}
                min={1}
                onChange={(event) => update(node.id, { slo: { ...slo, p99Ms: Number(event.target.value) } })}
                className="h-8 pr-9 font-mono text-sm tabular-nums"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                ms
              </span>
            </div>
          </Field>
        </div>
        <Field label="Errors">
          <div className="relative">
            <Input
              type="number"
              value={slo.errorRatePct}
              min={0}
              max={100}
              step={0.1}
              onChange={(event) =>
                update(node.id, { slo: { ...slo, errorRatePct: Number(event.target.value) } })
              }
              className="h-8 pr-6 font-mono text-sm tabular-nums"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
              %
            </span>
          </div>
        </Field>
      </FieldGroup>
    </div>
  );
}
