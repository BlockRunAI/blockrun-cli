/**
 * `blockrun chat [--model m]` — interactive multi-turn REPL.
 *
 * Keeps the running message history and sends it through chatCompletion each
 * turn. Exit with /exit, /quit, or Ctrl-C. `/model <id>` switches models
 * mid-session; `/cost` shows what this session has spent so far.
 */

import * as readline from "node:readline";
import { LLMClient } from "@blockrun/llm";
import { resolvePrivateKey } from "@blockrun/core";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_MODEL = "nvidia/deepseek-v4-flash"; // free — no spend until the user picks a paid model

export async function chatRepl(modelFlag?: string): Promise<number> {
  const resolved = resolvePrivateKey();
  if (!resolved) {
    process.stderr.write("✗ wallet: No wallet found. Run `blockrun wallet create`.\n");
    return 1;
  }
  const client = new LLMClient({ privateKey: resolved.privateKey });
  let model = modelFlag || DEFAULT_MODEL;
  const history: ChatMsg[] = [];
  let spent = 0;

  process.stdout.write(`blockrun chat — model: ${model} (/model <id> to switch, /exit to quit)\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "you> " });
  rl.prompt();

  return new Promise<number>((resolve) => {
    let closed = false;
    const reprompt = () => {
      if (!closed) rl.prompt();
    };
    rl.on("close", () => {
      closed = true;
      resolve(0);
    });
    rl.on("line", (line) => {
      void (async () => {
        const input = line.trim();
        if (!input) return reprompt();
        if (input === "/exit" || input === "/quit") return rl.close();
        if (input.startsWith("/model")) {
          const next = input.split(/\s+/)[1];
          if (next) {
            model = next;
            process.stdout.write(`model → ${model}\n`);
          } else process.stdout.write(`model: ${model}\n`);
          return reprompt();
        }
        if (input === "/cost") {
          process.stdout.write(`session spend: ~$${spent.toFixed(4)}\n`);
          return reprompt();
        }
        history.push({ role: "user", content: input });
        try {
          const res = (await client.chatCompletion(model, history as never)) as unknown as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { total_cost?: number };
          };
          const reply = res.choices?.[0]?.message?.content ?? "(empty reply)";
          if (typeof res.usage?.total_cost === "number") spent += res.usage.total_cost;
          history.push({ role: "assistant", content: reply });
          process.stdout.write(`${reply}\n`);
        } catch (e) {
          history.pop(); // drop the failed turn so retries are clean
          process.stderr.write(`✗ ${(e as Error).message}\n`);
        }
        reprompt();
      })();
    });
  });
}
