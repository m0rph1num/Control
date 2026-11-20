import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "window", {
    value: { __TAURI_INTERNALS__: {} },
    configurable: true,
  });
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import { api } from "./index";

const invokeMock = vi.mocked(invoke);

describe("shared/api", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("protectionStatus вызывает правильную команду", async () => {
    invokeMock.mockResolvedValue({
      state: "active",
      detail: "ok",
      revision: 1,
    });
    await api.protectionStatus();
    expect(invokeMock).toHaveBeenCalledWith("protection_status");
  });

  it("protectionStart передаёт имя стратегии без путей", async () => {
    invokeMock.mockResolvedValue("op-id");
    await api.protectionStart("general");
    expect(invokeMock).toHaveBeenCalledWith("protection_start", {
      strategyValue: "general",
    });
  });
});
