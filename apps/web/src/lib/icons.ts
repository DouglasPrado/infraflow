import {
  Activity,
  Binary,
  Boxes,
  ChartBar,
  Circle,
  Container,
  Database,
  Gauge,
  Globe,
  HardDrive,
  Layers,
  MessageSquare,
  Network,
  Package,
  Radio,
  Route,
  Rows3,
  Satellite,
  Scale,
  Server,
  Waypoints,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Resolve o identificador de ícone do registry para um componente Lucide.
 *
 * O `@infraflow/registry` é livre de UI — a API e os workers também o consomem —
 * então o ícone viaja como string e só vira componente aqui (design.md §7).
 */
const ICONS: Record<string, { Icon: LucideIcon }> = {
  activity: { Icon: Activity },
  binary: { Icon: Binary },
  boxes: { Icon: Boxes },
  "chart-bar": { Icon: ChartBar },
  container: { Icon: Container },
  database: { Icon: Database },
  gauge: { Icon: Gauge },
  globe: { Icon: Globe },
  "hard-drive": { Icon: HardDrive },
  layers: { Icon: Layers },
  "message-square": { Icon: MessageSquare },
  network: { Icon: Network },
  package: { Icon: Package },
  radio: { Icon: Radio },
  route: { Icon: Route },
  "rows-3": { Icon: Rows3 },
  satellite: { Icon: Satellite },
  scale: { Icon: Scale },
  server: { Icon: Server },
  waypoints: { Icon: Waypoints },
  zap: { Icon: Zap },
};

const FALLBACK = { Icon: Circle };

export function resolveIcon(name: string | undefined): { Icon: LucideIcon } {
  return (name ? ICONS[name] : undefined) ?? FALLBACK;
}
