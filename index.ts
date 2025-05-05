import OpenAI from "./openai";
import { type Token, buildTree } from "./logit-loom";

interface UIElements {
  baseURL: HTMLInputElement;
  apiKey: HTMLInputElement;
  modelName: HTMLInputElement;

  prompt: HTMLTextAreaElement;
  prefill: HTMLTextAreaElement;

  depth: HTMLInputElement;
  maxWidth: HTMLInputElement;
  coverProb: HTMLInputElement;

  runButton: HTMLButtonElement;
  spinner: HTMLDivElement;
  treeContainer: HTMLDivElement;
}

function getUI(): UIElements {
  const $ = document.querySelector.bind(document);
  function ensure<T>(name: string, t: T | null): T {
    if (t === null) {
      throw new Error(`couldn't find an element for ${name}`);
    }
    return t;
  }
  return {
    baseURL: ensure("base-url", $("input#base-url")),
    apiKey: ensure("api-key", $("input#api-key")),
    modelName: ensure("model-name", $("input#model-name")),
    prompt: ensure("prompt", $("textarea#prompt")),
    prefill: ensure("prefill", $("textarea#prefill")),
    depth: ensure("depth", $("input#depth")),
    maxWidth: ensure("max-children", $("input#max-width")),
    coverProb: ensure("search-prob", $("input#cover-prob")),
    runButton: ensure("run-button", $("button#run")),
    spinner: ensure("spinner", $("div.spinner")),
    treeContainer: ensure("tree-container", $("div#tree-container")),
  };
}

/** Sync an <input> or <textarea> with localStorage */
function syncWithLocalStorage(e: HTMLInputElement | HTMLTextAreaElement, storageKey: string) {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    e.value = saved;
  }
  e.addEventListener("input", () => {
    localStorage.setItem(storageKey, e.value);
  });
}


function renderTree(roots: Token[]) {
  const container = document.querySelector("#tree-container");
  if (!container) return;

  function renderNode(node: Token): string {
    const text = node.text.replace("<", "&lt;").replace(">", "&gt;").replace(" ", "␣").replace("\n", "↵");
    const children = node.children.map(renderNode).join("");
    const [s, s1] = node.children.length ? ["<strong>", "</strong>"] : ["", ""];
    const end = node.branchFinished != null && node.children.length === 0 ? `<|${node.branchFinished}|>` : "";
    return `
      <li>
        <div>
          <span class="token">${s}${text}${s1}</span>
          <span class="prob">(${(node.prob * 100).toFixed(2)}%)</span>
          <span class="extra">[${node.logprob.toFixed(4)}] ${end}</span>
          <button class="add-prefill" data-uuid="${node.id}" title="Add to prefill">📥</button>
        </div>
        ${children ? `<ol>${children}</ol>` : ""}
      </li>
    `;
  }

  container.innerHTML = `<ol>${roots.map(renderNode).join("")}</ol>`;
}

let loading = false;
function run(elements: UIElements) {
  if (loading) {
    return;
  }
  const baseURL = elements.baseURL.value;
  const apiKey = elements.apiKey.value;
  const modelName = elements.modelName.value;
  const prompt = elements.prompt.value;
  const prefill = elements.prefill.value;
  const depth = parseInt(elements.depth.value);
  const maxWidth = parseInt(elements.maxWidth.value);
  const coverProb = parseFloat(elements.coverProb.value) / 100;
  if (!baseURL || !apiKey || !modelName || !prompt) {
    alert("Please fill in Base URL, API key, model name, and prompt");
    return;
  }

  const client = new OpenAI({
    baseURL,
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  loading = true;
  elements.spinner.removeAttribute("hidden");
  elements.runButton.disabled = true;
  buildTree({
    client,
    model: modelName,
    prompt,
    prefill,
    depth,
    maxWidth,
    coverProb,
    progress: renderTree,
  })
    .then(() => {
      elements.runButton.disabled = false;
      elements.spinner.setAttribute("hidden", "true");
      loading = false;
    })
    .catch((err) => {
      elements.runButton.disabled = false;
      elements.spinner.setAttribute("hidden", "true");
      loading = false;
      console.error(err);
      elements.treeContainer.innerText = err;
    });
}

document.addEventListener("DOMContentLoaded", () => {
  const elements = getUI();
  syncWithLocalStorage(elements.baseURL, "baseUrl");
  syncWithLocalStorage(elements.apiKey, "apiKey");
  syncWithLocalStorage(elements.modelName, "modelName");
  syncWithLocalStorage(elements.prompt, "lastPrompt");
  syncWithLocalStorage(elements.prefill, "lastPrefill");
  syncWithLocalStorage(elements.depth, "depth");
  syncWithLocalStorage(elements.maxWidth, "maxWidth");
  syncWithLocalStorage(elements.coverProb, "coverProb");
  elements.runButton.addEventListener("click", () => run(elements));
});
