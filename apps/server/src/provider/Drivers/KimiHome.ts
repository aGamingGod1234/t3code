import * as NodeOS from "node:os";

import type { KimiSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";

export const resolveKimiHomePath = Effect.fn("resolveKimiHomePath")(function* (
  config: Pick<KimiSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  return homePath.length > 0
    ? path.resolve(expandHomePath(homePath))
    : path.resolve(NodeOS.homedir(), ".kimi-code");
});

export const makeKimiEnvironment = Effect.fn("makeKimiEnvironment")(function* (
  config: Pick<KimiSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const environment = baseEnv ?? process.env;
  if (config.homePath.trim().length === 0) {
    return environment;
  }
  return {
    ...environment,
    KIMI_CODE_HOME: yield* resolveKimiHomePath(config),
  };
});

export const makeKimiContinuationGroupKey = Effect.fn("makeKimiContinuationGroupKey")(function* (
  config: Pick<KimiSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  return `kimi:home:${yield* resolveKimiHomePath(config)}`;
});
