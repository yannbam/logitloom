import { useEffect, useLayoutEffect, type JSX } from "react";
import ReactDOM from "react-dom/client";
import useLocalStorageState from "use-local-storage-state";

import { type Token } from "./logit-loom";
import { useTreeStore, run, interruptRun, getTokenAndPrefix, loadTreeFromLocalStorage } from "./tree-store";

function App(): JSX.Element {
  const [baseUrl, setBaseUrl] = useLocalStorageState<string>("baseUrl");
  const [apiKey, setApiKey] = useLocalStorageState<string>("apiKey");
  const [modelName, setModelName] = useLocalStorageState<string>("modelName");
  const [prompt, setPrompt] = useLocalStorageState<string>("lastPrompt");
  const [prefill, setPrefill] = useLocalStorageState<string>("lastPrefill");
  const [depth, setDepth] = useLocalStorageState<number>("depth", { defaultValue: 5 });
  const [width, setWidth] = useLocalStorageState<number>("maxWidth", { defaultValue: 3 });
  const [coverProb, setCoverProb] = useLocalStorageState<number>("coverProb", { defaultValue: 0.8 });
  const store = useTreeStore();

  useEffect(() => {
    loadTreeFromLocalStorage();
  }, []);

  return (
    <>
      <Settings>
        <TextSetting label="Base URL" type="text" value={baseUrl} onChange={setBaseUrl} />{" "}
        <TextSetting label="API Key" type="password" value={apiKey} onChange={setApiKey} />{" "}
        <TextSetting label="Model" type="text" value={modelName} onChange={setModelName} />
      </Settings>
      <hr />
      <Settings>
        <PromptSetting label="Prompt" value={prompt} onChange={setPrompt} />{" "}
        <PromptSetting label="Prefill" value={prefill} onChange={setPrefill} />
      </Settings>
      <hr />
      <Settings>
        <NumberSetting
          label="Depth"
          tooltip="Expand this many tokens deep."
          min={1}
          max={100}
          step={1}
          value={depth}
          onChange={setDepth}
        />{" "}
        <NumberSetting
          label="Max children"
          tooltip="Expand up to this many child tokens."
          min={1}
          max={100}
          step={1}
          value={width}
          onChange={setWidth}
        />{" "}
        <NumberSetting
          label="Top P"
          tooltip="Expand children until the cumulative probability reaches this value, or max children."
          min={0}
          max={100}
          step={5}
          value={coverProb * 100}
          onChange={(v) => setCoverProb(v / 100)}
        />{" "}
        <button
          disabled={!baseUrl || !apiKey || !modelName || store.running}
          onClick={() => {
            if (!baseUrl || !apiKey || !modelName || store.running) {
              return;
            }
            run({
              baseUrl,
              apiKey,
              modelName,
              prompt,
              prefill,
              depth,
              maxWidth: width,
              coverProb,
            });
          }}
        >
          Run
        </button>{" "}
        <div className="spinner" hidden={!store.running}></div>{" "}
        <button hidden={!store.running} disabled={store.interrupting} onClick={interruptRun}>
          {store.interrupting ? "Stopping..." : "Stop"}
        </button>
      </Settings>
      <hr />
      <div>
        {store.value.kind === "tree" ? (
          <Tree
            roots={store.value.roots}
            onClickAddPrefill={(id) => {
              const newPrefill = getTokenAndPrefix(store, id);
              if (newPrefill !== null) {
                setPrefill((prefill ?? "") + newPrefill);
              }
            }}
          />
        ) : (
          <p style={{ color: "red" }}>{store.value.error.toString()}</p>
        )}
      </div>
    </>
  );
}

function Tree(props: { roots: Token[]; onClickAddPrefill: (id: string) => void }): JSX.Element {
  return (
    <ol>
      {props.roots.map((c) => (
        <TreeNode
          key={c.id}
          node={c}
          parent={null}
          siblings={props.roots}
          onClickAddPrefill={props.onClickAddPrefill}
        />
      ))}
    </ol>
  );
}

function TreeNode({
  node,
  parent,
  siblings,
  parentHasShortDownLine,
  onClickAddPrefill,
}: {
  node: Token;
  parent: Token | null;
  siblings: Token[];
  parentHasShortDownLine?: boolean;
  onClickAddPrefill: (id: string) => void;
}): JSX.Element {
  // has a down line if any children
  const hasDownLine = node.children.length > 0;
  // ...but it's short if it's an only child or the last child
  const hasShortDownLine = hasDownLine && (siblings.length === 1 || siblings.at(-1) === node);
  // has a left line if it has a parent, and either
  // 1. parent doesn't have a short down line
  // 2. parent does have a short down line, but this is the first child
  const hasLeftLine = parent === null ? false : parentHasShortDownLine ? siblings[0] === node : true;

  const recoveredEmoji = tryRecoverBrokenEmoji(node, parent);

  const text = node.text.replace(" ", "␣").replace("\n", "↵");
  return (
    <li
      className={
        (hasDownLine ? "has-down-line " : "") +
        (hasShortDownLine ? "has-short-down-line " : "") +
        (hasLeftLine ? "has-left-line " : "")
      }
    >
      <div>
        <span className="token">{node.children.length ? <strong>{text}</strong> : text}</span>{" "}
        {recoveredEmoji ? <span className="token-utf8">utf8: {recoveredEmoji.trim()}</span> : ""}{" "}
        <span className="prob">({(node.prob * 100).toFixed(2)}%)</span>{" "}
        <span className="extra">
          [{node.logprob.toFixed(4)}]{" "}
          {node.branchFinished != null && node.children.length === 0 && `<|${node.branchFinished}|>`}
        </span>{" "}
        <button className="add-prefill" title="Add to prefill" onClick={() => onClickAddPrefill(node.id)}>
          📥
        </button>
      </div>
      {!!node.children.length && (
        <ol>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              parent={node}
              siblings={node.children}
              parentHasShortDownLine={hasShortDownLine}
              onClickAddPrefill={onClickAddPrefill}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function Settings(props: { children?: React.ReactNode | undefined }): JSX.Element {
  return <div className="settings-container">{props.children}</div>;
}

function TextSetting(props: {
  label: string;
  type: "text" | "password";
  value: string | undefined;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label style={!props.value ? { color: "rgb(128, 32, 32)" } : {}}>
      <span>{props.label}:</span>{" "}
      <input
        style={!props.value ? { backgroundColor: "rgb(228, 50, 50)" } : {}}
        placeholder="(required)"
        type={props.type}
        value={props.value}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function PromptSetting(props: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label>
      <span>{props.label}:</span>{" "}
      <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)}></textarea>
    </label>
  );
}

const Tooltip = (props: { tooltip: string }) => <abbr title={props.tooltip}>(?)</abbr>;

function NumberSetting(props: {
  label: string;
  tooltip: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label>
      <span>{props.label}: </span>{" "}
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />{" "}
      <span>
        <Tooltip tooltip={props.tooltip} />
      </span>
    </label>
  );
}

/**
 * Try to fix broken emoji sequences, e.g. { text: "\\x20\\xf0\\x9f\\x8c", ... },
 * which may be spread over multiple tokens.
 * 
 * TODO right now this only handles simple situations like \\x20\\xf0\\x9f -> \\x8c in two tokens
 * Other things I've seen:
 * 
 * - \\x11 -> \\x22\\x33 -> \\x44 over three or more tokens
 * - \\x11\\x22 -> \\x -> 33 where the byte escaoe is split between two tokens(!)
 * 
 * Need to handle these still.
 * **/
function tryRecoverBrokenEmoji(token: Token, parent: Token | null): string | null {
  if (!looksLikeEscapedUtf8(token.text)) {
    return null;
  }

  // If we have a parent, try to combine with parent text
  if (parent && looksLikeEscapedUtf8(parent.text)) {
    const combinedDecoded = decodeEscapedUtf8(parent.text + token.text);
    if (combinedDecoded) {
      return combinedDecoded;
    }
  }

  // Try to decode the token text by itself
  const selfDecoded = decodeEscapedUtf8(token.text);
  if (selfDecoded) {
    return selfDecoded;
  }

  return null;
}

function looksLikeEscapedUtf8(s: string): boolean {
  return s.match(/^(\\x[0-9a-fA-F]{2})+$/g) !== null;
}

function decodeEscapedUtf8(s: string): string | null {
  let rawBytes = "";
  s.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => (rawBytes += String.fromCharCode(parseInt(hex, 16))));

  const bytes = Uint8Array.from(rawBytes, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const appDiv = document.querySelector("#app");
  if (!appDiv) {
    throw new Error("Missing #app div");
  }

  ReactDOM.createRoot(appDiv).render(<App />);
});
