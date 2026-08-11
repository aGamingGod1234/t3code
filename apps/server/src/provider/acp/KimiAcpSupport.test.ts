import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";
import { describe, expect, it } from "vite-plus/test";

import { applyKimiAcpModelSelection, buildKimiAcpSpawnInput } from "./KimiAcpSupport.ts";

describe("buildKimiAcpSpawnInput", () => {
  it("puts tokenized global launch arguments before the Kimi ACP subcommand", () => {
    expect(
      buildKimiAcpSpawnInput(
        { binaryPath: "/opt/kimi", launchArgs: "--agent coder --skills-dir 'team skills'" },
        "/repo",
        { KIMI_CODE_HOME: "/homes/work" },
      ),
    ).toEqual({
      command: "/opt/kimi",
      args: ["--agent", "coder", "--skills-dir", "team skills", "acp"],
      cwd: "/repo",
      env: { KIMI_CODE_HOME: "/homes/work" },
    });
  });
});

describe("applyKimiAcpModelSelection", () => {
  it("sets the requested model before applying only compatible advertised option selections", async () => {
    const calls: Array<
      | { readonly type: "model"; readonly value: string }
      | { readonly type: "config"; readonly id: string; readonly value: string | boolean }
    > = [];
    const configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
      {
        id: "reasoning",
        name: "Reasoning",
        type: "select",
        currentValue: "medium",
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      },
      {
        id: "auto-approve",
        name: "Auto approve",
        type: "boolean",
        currentValue: false,
      },
    ];
    const runtime = {
      getConfigOptions: Effect.sync(() => configOptions),
      setModel: (value: string) =>
        Effect.sync(() => {
          calls.push({ type: "model", value });
        }),
      setConfigOption: (id: string, value: string | boolean) =>
        Effect.sync(() => {
          calls.push({ type: "config", id, value });
        }),
    };

    await Effect.runPromise(
      applyKimiAcpModelSelection({
        runtime,
        model: "kimi-k2",
        selections: [
          { id: "reasoning", value: "high" },
          { id: "auto-approve", value: true },
          { id: "missing", value: "ignored" },
          { id: "reasoning", value: true },
          { id: "auto-approve", value: "true" },
        ],
      }),
    );

    expect(calls).toEqual([
      { type: "model", value: "kimi-k2" },
      { type: "config", id: "reasoning", value: "high" },
      { type: "config", id: "auto-approve", value: true },
    ]);
  });
});
