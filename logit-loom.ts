import type { ChatCompletionMessageParam, ChatCompletionTokenLogprob } from "openai/resources/index.mjs";
import OpenAI from "./openai";
import * as uuid from "uuid";

export interface Token {
  id: string;
  text: string;
  logprob: number;
  prob: number;
  /** If non-null, all tokens below this token will also be non-null, and this branch shouldn't be expanded. */
  branchFinished: BranchFinishReason | null;
  children: Token[];
}

export interface TreeOptions {
  client: InstanceType<typeof OpenAI>;
  model: string;
  prompt: string;
  prefill?: string;
  depth: number;
  maxWidth: number;
  coverProb: number;
  progress: (tokens: Token[]) => void;
}

export async function buildTree(opts: TreeOptions): Promise<Token[]> {
  const roots: Token[] = [];
  appendTokens(roots, await query([], opts));
  console.log("roots", roots);
  opts.progress(roots);

  // repeatedly walk the tree until there are no nodes left to expand
  while (true) {
    const prefix = getContinuablePrefix(roots, opts.depth);
    if (prefix === null) {
      break;
    }
    appendTokens(prefix.at(-1)!, await query(prefix, opts));
    opts.progress(roots);
  }
  return roots;
}

type BranchFinishReason = "stop" | "content_filter" | "tool_calls" | "function_call";
type QueriedLogprobs =
  | {
      kind: "logprobs";
      logprobs: Array<{
        chosenToken: string;
        /** If non-null, the **chosen** token branch is finished. (But other branches discovered here might be alive.) */
        finishReason: BranchFinishReason | null;
        topLogprobs: ChatCompletionTokenLogprob.TopLogprob[];
      }>;
    }
  | {
      /** The entire branch you tried to query is finished. */
      kind: "finish";
      finishReason: BranchFinishReason;
    };
async function query(tokens: Token[], opts: TreeOptions): Promise<QueriedLogprobs> {
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
  console.log("request:", messages);

  const response = await opts.client.chat.completions.create({
    model: opts.model,
    messages,
    logprobs: true,
    top_logprobs: opts.maxWidth,
    max_tokens: opts.depth - tokens.length,
    temperature: 1.0, // no logit scaling
    //   include_reasoning: true,
    //   // @ts-expect-error openrouter shenanigans
    //   provider: {
    //     order: ["DeepSeek"],
    //     allow_fallbacks: false,
    //   }
  });
  console.log("response:", response);

  const choice = response.choices[0];
  if (choice == null) {
    throw new Error("response missing choices!");
  }
  const logprobs = choice.logprobs?.content;
  if (logprobs == null) {
    if (choice.finish_reason != "length") {
      // stopped because this branch is over
      return { kind: "finish", finishReason: choice.finish_reason };
    }
    throw new Error("response missing logprobs!");
  }
  return {
    kind: "logprobs",
    logprobs: logprobs.map((l) => {
      const tlps = l.top_logprobs.sort((a, b) => -(a.logprob - b.logprob));
      return {
        chosenToken: l.token,
        finishReason: choice.finish_reason == null || choice.finish_reason === "length" ? null : choice.finish_reason,
        topLogprobs: sliceToProb(tlps, opts.coverProb),
      };
    }),
  };
}

function appendTokens(parent: Token | Token[], queried: QueriedLogprobs) {
  if (queried.kind === "finish") {
    if (!Array.isArray(parent)) {
      parent.branchFinished = queried.finishReason;
    } else {
      parent.push({
        id: uuid.v4(),
        text: `<|${queried.finishReason}|>`,
        logprob: 0,
        prob: 1,
        branchFinished: queried.finishReason,
        children: [],
      });
    }
    return;
  }

  let to = Array.isArray(parent) ? parent : parent.children;
  for (let { chosenToken, finishReason, topLogprobs } of queried.logprobs) {
    for (let { token, logprob } of topLogprobs) {
      to.push({
        id: uuid.v4(),
        text: token,
        logprob: logprob,
        prob: Math.exp(logprob),
        branchFinished: token === chosenToken ? finishReason : null,
        children: [],
      });
    }
    const next = to.find((t) => t.text === chosenToken);
    if (next == null) {
      return; // chosen token was outside the top logprobs, no joy
    }
    to = next.children;
  }
}

/** Take a (sorted) list of top logprobs, and slice it to the shortest length that has a total probability > `prob` */
function sliceToProb(
  tokens: ChatCompletionTokenLogprob.TopLogprob[],
  prob: number
): ChatCompletionTokenLogprob.TopLogprob[] {
  let cumprob = 0;
  let i = 0;
  while (cumprob < prob && i < tokens.length) {
    cumprob += Math.exp(tokens[i]!.logprob);
    i++;
  }
  return tokens.slice(0, i);
}

function getContinuablePrefix(roots: Token[], maxDepth: number): Token[] | null {
  for (let root of roots) {
    for (let traversal of _treeTraversals(root)) {
      const last = traversal.at(-1);
      if (last == null || traversal.length >= maxDepth) {
        continue;
      }
      if (last.children.length === 0 && !last.branchFinished) {
        return traversal;
      }
    }
  }
  return null;
}

function* _treeTraversals(token: Token): Generator<Token[]> {
  if (token.children.length === 0) {
    yield [token];
  } else {
    for (let child of token.children) {
      for (let subtraversal of _treeTraversals(child)) {
        yield [token, ...subtraversal];
      }
    }
  }
}
