import type { TgwsStatus } from "@/shared/api";

let tgws: TgwsStatus | null = null;

export function cachedTgwsStatus() {
  return tgws;
}

export function cacheTgwsStatus(status: TgwsStatus | null) {
  tgws = status;
}
