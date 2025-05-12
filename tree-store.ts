import { useSyncExternalStore } from "react";
import OpenAI from "./openai";

import { buildTree, expandTree, pathToNodeWithId, type Token } from "./logit-loom";
import { type ApiInfo, sniffApi } from "./api-sniffer";
import * as SaveLoad from "./save-load";

export function useTreeStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot);
}

let listeners: Array<() => void> = [];
export interface State {
  running: boolean;
  interrupting: boolean;
  value:
    | { kind: "tree"; roots: Token[] }
    | {
        kind: "error";
        error: any;
        /** The previous roots before the error, if they existed. */
        roots: Token[] | null;
      };
  baseUrlApiInfoCache: Record<string, ApiInfo>;
}
let state: State = {
  running: false,
  interrupting: false,
  value: { kind: "tree", roots: [] },
  baseUrlApiInfoCache: {},
};

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function emitChange() {
  for (let listener of listeners) {
    listener();
  }
}

function getSnapshot(): State {
  return state;
}

/** Return the token string for a given token -- all the tokens before it, and itself, joined together. */
export function getTokenAndPrefix(state: State, id: string): string | null {
  if (state.value.roots == null) {
    return null;
  }
  const path = pathToNodeWithId(id, state.value.roots);
  if (path === null) {
    return null;
  }
  return path.map((t) => t.text).join("");
}

export function loadTreeFromLocalStorage() {
  state = { ...state, value: { kind: "tree", roots: tryGetTreeFromLocalStorage() } };
  emitChange();
}

export function setTree(roots: Token[]) {
  if (state.running) {
    return;
  }
  state = { ...state, value: { kind: "tree", roots } };
  emitChange();
}

export type SerializedModelSettings = SaveLoad.SerializedTree["modelSettings"];

export function saveTree(modelName: string, modelSettings: SerializedModelSettings) {
  const roots = state.value.roots;
  if (state.running || roots == null) {
    return;
  }

  SaveLoad.saveTree({
    isLogitLoomTreeVersion: "logit-loom-tree-v1",
    modelName,
    modelSettings,
    roots,
  });
}

export function loadTree(
  importSettings: (modelName: string, modelSettings: SerializedModelSettings) => void
) {
  if (state.running) {
    return;
  }

  SaveLoad.loadTree({
    onDone: (tree) => {
      state = { ...state, value: { kind: "tree", roots: tree.roots } };
      emitChange();
      importSettings(tree.modelName, tree.modelSettings);
    },
    onError: (error) => {
      state = { ...state, value: { kind: "error", error, roots: state.value.roots } };
      emitChange();
    },
    onCancel: () => {},
  });
}

export function interruptRun() {
  if (!state.running || state.interrupting) {
    return;
  }
  state = { ...state, interrupting: true };
  emitChange();
}

export function run(opts: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  modelType: "chat" | "base";
  prompt: string | undefined;
  prefill: string | undefined;
  depth: number;
  maxWidth: number;
  coverProb: number;
  fromNodeId?: string;
}) {
  if (state.running) {
    return;
  }

  const client = new OpenAI({
    baseURL: opts.baseUrl,
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true,
  });

  state = { ...state, running: true };
  emitChange();

  async function getApiInfo(): Promise<ApiInfo> {
    if (!isProbablyLocalhost(opts.baseUrl)) {
      // don't *use* cache for localhost because it's liable to change if the user runs a new server
      // but we still store it for the UI to render warnings
      const cachedApiInfo = state.baseUrlApiInfoCache[opts.baseUrl];
      if (cachedApiInfo != null) {
        return cachedApiInfo;
      }
    }
    const apiInfo = await sniffApi(opts.baseUrl, opts.apiKey);
    state = { ...state, baseUrlApiInfoCache: { ...state.baseUrlApiInfoCache, [opts.baseUrl]: apiInfo } };
    emitChange();
    return apiInfo;
  }

  function progress(roots: Token[]) {
    state = { ...state, value: { kind: "tree", roots } };
    trySyncTreeToLocalStorage(roots);
    emitChange();
    return state.interrupting; // interrupt if user requested it
  }

  let promise: Promise<Token[]>;
  const fromNodeId = opts.fromNodeId;
  if (fromNodeId == null) {
    promise = getApiInfo().then((apiInfo) =>
      buildTree({
        client,
        baseUrl: opts.baseUrl,
        apiInfo,
        model: opts.modelName,
        modelType: opts.modelType,
        prompt: opts.prompt,
        prefill: opts.prefill,
        depth: opts.depth,
        maxWidth: opts.maxWidth,
        coverProb: opts.coverProb,
        progress,
      })
    );
  } else {
    const roots = state.value.roots;
    if (roots == null) {
      throw new Error(`ui bug: state missing tree, can't expand '${opts.fromNodeId}' (how did you get this id?)`);
    }
    promise = getApiInfo().then((apiInfo) =>
      expandTree(
        {
          client,
          baseUrl: opts.baseUrl,
          apiInfo,
          model: opts.modelName,
          modelType: opts.modelType,
          prompt: opts.prompt,
          prefill: opts.prefill,
          depth: opts.depth,
          maxWidth: opts.maxWidth,
          coverProb: opts.coverProb,
          progress,
        },
        roots,
        fromNodeId
      )
    );
  }

  promise
    .then((roots) => {
      state = { ...state, value: { kind: "tree", roots }, running: false, interrupting: false };
      trySyncTreeToLocalStorage(roots);
      emitChange();
    })
    .catch((error) => {
      state = {
        ...state,
        running: false,
        interrupting: false,
        value: { kind: "error", error, roots: state.value.roots },
      };
      emitChange();
      console.error(error);
    });
}

// TODO: this was added before save-load.ts, but it would be nice to unify the mechanisms
const treeLocalStorageKey = "prevTree";

/** Get the previous tree from localStorage, or an empty tree on error / missing tree. */
function tryGetTreeFromLocalStorage(): Token[] {
  try {
    const value = localStorage.getItem(treeLocalStorageKey);
    if (value == null) {
      return [];
    }
    const tree = JSON.parse(value);
    if (!Array.isArray(tree)) {
      // TODO: basic validation, should really parse this with zod or something
      console.warn(`item in prevTree doesn't seem to be a tree?`, tree);
      return [];
    }
    console.log("loaded tree from localStorage:", tree);
    return tree as Token[];
  } catch (e) {
    console.error("getting tree from localStorage:", e);
    return [];
  }
}

/** Attempt to sync the tree to localStorage. */
function trySyncTreeToLocalStorage(roots: Token[]) {
  try {
    localStorage.setItem(treeLocalStorageKey, JSON.stringify(roots));
  } catch (e) {
    console.error("persisting tree to localStorage:", e);
  }
}

function isProbablyLocalhost(url: string): boolean {
  return (
    url.includes("//localhost") ||
    url.includes("//127.0.0") ||
    url.includes("//[::1]") ||
    url.includes("//[0:0:0:0:0:0:0:1")
  );
}
