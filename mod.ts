//@ts-check
/// <reference types="@cloudflare/workers-types" />
import {
  ExecFn,
  RawFn,
  studioMiddleware,
  StudioOptions,
  QueryableObject,
  GetSchemaFn,
  QueryableHandler,
} from "queryable-object";
import { getMultiStub, MultiStubConfig } from "multistub";
// Re-export useful features
export * from "multistub";
export * from "migratable-object";
export * from "transferable-object";
export * from "queryable-object";
export * from "./util";

export type SqlStorageValue = ArrayBuffer | string | number | null;
export type Records = { [x: string]: SqlStorageValue };
export interface StudioConfig extends StudioOptions {
  pathname?: string;
}

export type DORMClient<T extends Rpc.DurableObjectBranded & QueryableHandler> =
  {
    /** A stub linked to both your main DO and mirror DO for executing any RPC function on both and retrieving the response only from the first */
    stub: DurableObjectStub<T>;
    /**
     * Middleware to expose exec to be browsable using outerbase
     *
     * NB: although it's async you can safely insert this as the async part only applies in the /query/raw endpoint
     */
    studio: (
      request: Request,
      options?: StudioConfig
    ) => Promise<Response | undefined>;
    // Easier to get
    exec: ExecFn;
    raw: RawFn;
    getSchema: GetSchemaFn;
  };

/**
 * Creates a client for interacting with DORM
 * This is now an async function that initializes storage upfront
 */
export function createClient<
  T extends Rpc.DurableObjectBranded & QueryableHandler
>(context: {
  doNamespace: DurableObjectNamespace<T>;
  ctx: ExecutionContext;
  configs: MultiStubConfig[];
  studioConfig?: StudioConfig;
}): DORMClient<T> {
  const { doNamespace, ctx, configs, studioConfig } = context;
  if (!configs || configs.length === 0) {
    throw new Error("At least one DO configuration is required");
  }
  const multistub = getMultiStub<T>(doNamespace, configs, ctx);
  async function studio(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.pathname === (studioConfig.pathname || "/db")) {
      return studioMiddleware(request, multistub.raw, {
        basicAuth: studioConfig?.basicAuth,
        dangerouslyDisableAuth: studioConfig?.dangerouslyDisableAuth,
      });
    }
    return undefined;
  }

  // @ts-ignore - Type instantiation is excessively deep and possibly infinite.ts(2589)
  // Couldn't figure this out - https://x.com/solinvictvs/status/1671507561143476226
  const result: DORMClient<T> = {
    stub: multistub,
    studio,
    raw: multistub.raw,
    exec: multistub.exec,
    getSchema: multistub.getSchema,
  };
  return result;
}
