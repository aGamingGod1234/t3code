// @effect-diagnostics nodeBuiltinImport:off - executable ACP fixture setup uses Node filesystem boundaries.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  KimiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { makeKimiAdapter } from "./KimiAdapter.ts";

const decodeKimiSettings = Schema.decodeSync(KimiSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

async function makeKimiWrapper(extraEnv?: Record<string, string>) {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kimi-acp-mock-"));
  const windows = process.platform === "win32";
  const wrapperPath = NodePath.join(directory, windows ? "kimi.cmd" : "fake-kimi.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) =>
      windows
        ? `set "${key}=${value.replaceAll('"', '\\"')}"`
        : `export ${key}=${JSON.stringify(value)}`,
    )
    .join("\n");
  const script = windows
    ? `@echo off\r\n${envExports}\r\n${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} %*\r\n`
    : `#!/bin/sh\n${envExports}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"\n`;
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  if (!windows) await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

async function readRequestMethods(requestLogPath: string) {
  const raw = await NodeFSP.readFile(requestLogPath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { readonly method?: string })
    .map((entry) => entry.method);
}

const kimiAdapterTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-kimi-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const makeTestAdapter = (binaryPath: string, instanceId = ProviderInstanceId.make("kimi")) =>
  makeKimiAdapter(decodeKimiSettings({ binaryPath }), { instanceId }).pipe(Effect.orDie);

it.layer(kimiAdapterTestLayer)("KimiAdapter", (it) => {
  it.effect("starts a Kimi ACP session and emits canonical prompt lifecycle events", () =>
    Effect.gen(function* () {
      const adapter = yield* makeTestAdapter(yield* Effect.promise(() => makeKimiWrapper()));
      const threadId = ThreadId.make("kimi-lifecycle");
      const events: ProviderRuntimeEvent[] = [];
      const completed = yield* Deferred.make<void>();
      const assistantCompleted = yield* Deferred.make<void>();
      const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)).pipe(
          Effect.andThen(
            event.type === "turn.completed" ? Deferred.succeed(completed, undefined) : Effect.void,
          ),
          Effect.andThen(
            event.type === "item.completed" && event.payload.itemType === "assistant_message"
              ? Deferred.succeed(assistantCompleted, undefined)
              : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("kimi"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { instanceId: ProviderInstanceId.make("kimi"), model: "default" },
      });
      assert.equal(session.provider, "kimi");
      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        sessionId: "mock-session-1",
      });

      const turn = yield* adapter.sendTurn({
        threadId,
        input: "Inspect this repository",
        attachments: [],
      });
      assert.equal(turn.threadId, threadId);
      yield* Deferred.await(completed);
      yield* Deferred.await(assistantCompleted);
      yield* Fiber.interrupt(eventsFiber);

      for (const type of [
        "item.started",
        "content.delta",
        "item.completed",
        "turn.plan.updated",
        "turn.completed",
      ] as const) {
        assert.include(
          events.map((event) => event.type),
          type,
        );
      }
      assert.isTrue(events.every((event) => event.provider === ProviderDriverKind.make("kimi")));
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("resumes the ACP session and keeps adapter instances isolated", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kimi-acp-resume-")),
      );
      const requestLogPath = NodePath.join(directory, "requests.ndjson");
      const first = yield* makeTestAdapter(
        yield* Effect.promise(() =>
          makeKimiWrapper({
            T3_ACP_ADVERTISE_RESUME: "1",
            T3_ACP_REQUEST_LOG_PATH: requestLogPath,
          }),
        ),
        ProviderInstanceId.make("kimi-work"),
      );
      const second = yield* makeTestAdapter(
        yield* Effect.promise(() => makeKimiWrapper()),
        ProviderInstanceId.make("kimi-personal"),
      );
      const resumedThread = ThreadId.make("kimi-resumed");
      const otherThread = ThreadId.make("kimi-other-instance");

      const session = yield* first.startSession({
        threadId: resumedThread,
        provider: ProviderDriverKind.make("kimi"),
        cwd: process.cwd(),
        runtimeMode: "approval-required",
        resumeCursor: { schemaVersion: 1, sessionId: "kimi-session-1" },
        modelSelection: { instanceId: ProviderInstanceId.make("kimi-work"), model: "default" },
      });
      yield* second.startSession({
        threadId: otherThread,
        provider: ProviderDriverKind.make("kimi"),
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });

      assert.equal(session.providerInstanceId, ProviderInstanceId.make("kimi-work"));
      assert.isTrue(yield* first.hasSession(resumedThread));
      assert.isFalse(yield* second.hasSession(resumedThread));
      assert.isTrue(yield* second.hasSession(otherThread));
      assert.include(
        yield* Effect.promise(() => readRequestMethods(requestLogPath)),
        "session/resume",
      );

      yield* first.stopAll();
      assert.isFalse(yield* first.hasSession(resumedThread));
      assert.isTrue(yield* second.hasSession(otherThread));
      yield* second.stopAll();
    }),
  );
});
