import type { ChatCompletionMessageParam } from "openai/resources/index.mjs";
import OpenAI from "./openai";

interface UIElements {
  baseURL: HTMLInputElement;
  apiKey: HTMLInputElement;
  modelName: HTMLInputElement;
  prompt: HTMLTextAreaElement;
  prefill: HTMLTextAreaElement;
  runButton: HTMLButtonElement;
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
    runButton: ensure("run-button", $("button#run")),
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

interface Token {
  text: string;
  logprob: number;
  prob: number;
  children: Token[];
}

function tokensUpToProb(tokens: Token[], prob: number): Token[] {
  let cumprob = 0;
  let i = 0;
  while (cumprob < prob && i < tokens.length) {
    cumprob += tokens[i]!.prob;
    i++;
  }
  return tokens.slice(0, i);
}

async function buildTree(opts: {
  client: InstanceType<typeof OpenAI>;
  model: string;
  prompt: string;
  prefill?: string;
  depth: number;
  maxWidth: number;
  coverProb: number;
  progress: (tokens: Token[]) => void;
}): Promise<Token[]> {
  async function query(tokens: Token[]): Promise<Token[]> {
    const messages: ChatCompletionMessageParam[] = [{ role: "user", content: opts.prompt }];
    if ((opts.prefill != null && opts.prefill.length > 0) || tokens.length > 0) {
      messages.push({
        role: "assistant",
        content: (opts.prefill ?? "") + tokens.map((t) => t.text).join(""),
        // @ts-expect-error "prefix" is a nonstandard deepseek thing
        // TODO shouldn't add unconditionally, only for deepseek base urls (not for openrouter)
        prefix: true,
      });
    }
    console.log(messages);
    const response = await opts.client.chat.completions.create({
      model: opts.model,
      messages,
      logprobs: true,
      top_logprobs: opts.maxWidth,
      max_completion_tokens: 1, // TODO this is inefficient
      temperature: 1.0, // no logit scaling
      //   include_reasoning: true,
      //   // @ts-expect-error openrouter shenanigans
      //   provider: {
      //     order: ["DeepSeek"],
      //     allow_fallbacks: false,
      //   }
    });
    console.log(response);
    const lps = response.choices[0]?.logprobs?.content?.[0]?.top_logprobs ?? [];
    lps.sort((a, b) => -(a.logprob - b.logprob));
    console.log(lps);
    return tokensUpToProb(
      lps.map(({ token, logprob }) => ({
        text: token,
        logprob,
        prob: Math.exp(logprob),
        children: [],
      })),
      opts.coverProb
    );
  }

  const roots = await query([]);
  opts.progress(roots);

  const queue = roots.map((token) => [token]);
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.length == opts.depth) {
      continue;
    }
    const children = await query(current);
    for (let c of children) {
      current.at(-1)!.children.push(c);
      queue.push([...current, c]);
    }
    opts.progress(roots);
  }

  return roots;
}

function renderTree(roots: Token[]) {
  const container = document.querySelector("#tree-container");
  if (!container) return;

  function renderNode(node: Token): string {
    const children = node.children.map(renderNode).join("");
    return `
            <li>
                <span>${node.text.replace("<", "&t;").replace(">", "&gt;")} (${node.prob.toFixed(4)})</span>
                ${children ? `<ol>${children}</ol>` : ""}
            </li>
        `;
  }

  container.innerHTML = `<ol>${roots.map(renderNode).join("")}</ol>`;
}

function run(elements: UIElements) {
  const baseURL = elements.baseURL.value;
  const apiKey = elements.apiKey.value;
  const modelName = elements.modelName.value;
  const prompt = elements.prompt.value;
  const prefill = elements.prefill.value;
  if (!baseURL || !apiKey || !modelName || !prompt) {
    alert("Please fill in Base URL, API key, model name, and prompt");
    return;
  }

  const client = new OpenAI({
    baseURL,
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  buildTree({
    client,
    model: modelName,
    prompt,
    prefill,
    depth: 5,
    maxWidth: 5,
    coverProb: 0.8,
    progress: renderTree,
  }).catch((err) => {
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
  elements.runButton.addEventListener("click", () => run(elements));
});
