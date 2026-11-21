import { cn } from "cn";
import type { AdvisorReport } from "@/shared/api";
import { pluralWord } from "@/shared/plural";

interface Stat {
  key: string;
  value: string;
  label: string;
  tone?: "warning";
}

export function AdvisorFacts({
  report,
  className,
}: {
  report: AdvisorReport;
  className?: string;
}) {
  const games = report.apps.filter((app) => app.kind === "game").length;
  const others = report.apps.length - games;
  const { network } = report;

  const stats: Stat[] = [];
  if (network.provider) {
    stats.push({
      key: "provider",
      value: network.provider,
      label: network.asn ?? "провайдер",
    });
  }
  if (network.downloadMbps !== null && typeof network.downloadMbps === "number") {
    stats.push({ key: "speed", value: String(network.downloadMbps), label: "Мбит/с" });
  }
  if (typeof network.avgLatencyMs === "number") {
    stats.push({ key: "latency", value: String(network.avgLatencyMs), label: "мс отклик" });
  }
  if (typeof network.jitterMs === "number" && network.jitterMs > 0) {
    stats.push({ key: "jitter", value: String(network.jitterMs), label: "мс джиттер" });
  }
  if (typeof network.lossPercent === "number" && network.lossPercent > 0) {
    stats.push({
      key: "loss",
      value: `${network.lossPercent}%`,
      label: "потери",
      tone: "warning",
    });
  }
  stats.push({
    key: "nodes",
    value: `${network.reachable} из ${network.total}`,
    label: "узлов",
    ...(network.reachable < network.total ? { tone: "warning" as const } : {}),
  });
  if (typeof network.tlsReachable === "number" && network.tlsReachable < network.total) {
    stats.push({
      key: "tls",
      value: `${network.tlsReachable} из ${network.total}`,
      label: "TLS",
      tone: "warning",
    });
  }
  if (games > 0) {
    stats.push({
      key: "games",
      value: String(games),
      label: pluralWord(games, ["игра", "игры", "игр"]),
    });
  }
  if (others > 0) {
    stats.push({
      key: "apps",
      value: String(others),
      label: pluralWord(others, ["приложение", "приложения", "приложений"]),
    });
  }
  if (network.mtu !== null) {
    stats.push({ key: "mtu", value: String(network.mtu), label: "MTU" });
  }

  return (
    <dl className={cn("flex flex-wrap items-baseline gap-x-7 gap-y-2.5", className)}>
      {stats.map((stat) => (
        <div key={stat.key} className="flex items-baseline gap-1.5">
          <dt className="order-2 text-[11px] leading-none text-muted-foreground">{stat.label}</dt>
          <dd
            className={cn(
              "numeric order-1 text-[15px] font-semibold leading-none",
              stat.tone === "warning" ? "text-warning" : "text-foreground",
            )}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
