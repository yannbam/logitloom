import type { ChatCompletionMessageParam, ChatCompletionTokenLogprob } from "openai/resources/index.mjs";
import OpenAI from "./openai";
import * as uuid from "uuid";

export interface Token {
  id: string;
  text: string;
  logprob: number;
  prob: number;
  /** If true, all tokens below this token will also be true, and this branch shouldn't be expanded. */
  branchFinished: boolean;
  children: Token[];
}

export async function buildTree(opts: {
  client: InstanceType<typeof OpenAI>;
  model: string;
  prompt: string;
  prefill?: string;
  depth: number;
  maxWidth: number;
  coverProb: number;
  progress: (tokens: Token[]) => void;
}): Promise<Token[]> {
  async function query(tokens: Token[]): Promise<Array<{
    chosenToken: string;
    finished: boolean;
    topLogprobs: ChatCompletionTokenLogprob.TopLogprob[];
  }> | null> {
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
      max_tokens: opts.depth - tokens.length,
      temperature: 1.0, // no logit scaling
      //   include_reasoning: true,
      //   // @ts-expect-error openrouter shenanigans
      //   provider: {
      //     order: ["DeepSeek"],
      //     allow_fallbacks: false,
      //   }
    });
    console.log(response);
    const choice = response.choices[0];
    if (choice == null) {
      throw new Error("response missing choices!");
    }
    const logprobs = choice.logprobs?.content;
    if (logprobs == null) {
      if (choice.finish_reason == "stop") {
        // stopped because this branch is over, signal with null
        return null;
      }
      throw new Error("response missing logprobs!");
    }
    return logprobs.map((l) => {
      const tlps = l.top_logprobs.sort((a, b) => -(a.logprob - b.logprob));
      return {
        chosenToken: l.token,
        finished: choice.finish_reason == "stop",
        topLogprobs: sliceToProb(tlps, opts.coverProb),
      };
    });
  }

  function appendTokens(parent: Token | Token[], queried: Awaited<ReturnType<typeof query>>) {
    if (queried === null) {
      // model endoftext'd
      if (!Array.isArray(parent)) {
        parent.branchFinished = true;
      } else {
        parent.push({
          id: uuid.v4(),
          text: "(model stopped)",
          logprob: 0,
          prob: 1,
          branchFinished: true,
          children: [],
        });
      }
      return;
    }

    let to = Array.isArray(parent) ? parent : parent.children;
    for (let { chosenToken, finished, topLogprobs } of queried) {
      for (let { token, logprob } of topLogprobs) {
        to.push({
          id: uuid.v4(),
          text: token,
          logprob: logprob,
          prob: Math.exp(logprob),
          branchFinished: finished && token == chosenToken,
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

  const roots: Token[] = [];
  appendTokens(roots, await query([]));
  console.log("roots", roots);
  opts.progress(roots);

  // repeatedly walk the tree until there are no nodes left to expand
  while (true) {
    const prefix = getContinuablePrefix(roots, opts.depth);
    if (prefix === null) {
      break;
    }
    appendTokens(prefix.at(-1)!, await query(prefix));
    opts.progress(roots);
  }
  return roots;
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
