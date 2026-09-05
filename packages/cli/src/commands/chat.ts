/**
 * `blockrun chat [--model m]` — interactive multi-turn REPL.
 *
 * Keeps the running message history and sends it through chatCompletion each
 * turn. Exit with /exit, /quit, or Ctrl-C. `/model <id>` switches models
 * mid-session; `/cost` shows what this session has spent so far.
 */

import * as readline from "node:readline";
import { llmClient } from "./auth.js";
import { escapeTerminalText, resolveApiKey, PORTAL_URL } from "@blockrun/core";
import { checkPolicy } from "./policy.js";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_MODEL = "nvidia/deepseek-v4-flash"; // free — no spend until the user picks a paid model

export interface ChatClient {
  chatCompletion(model: string, messages: unknown): Promise<unknown>;
}

export interface ChatReplOptions {
  client?: ChatClient;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
  policyCheck?: typeof checkPolicy;
}

export async function chatRepl(modelFlag?: string, opts: ChatReplOptions = {}): Promise<number> {
  const output = opts.output ?? process.stdout;
  const error = opts.error ?? process.stderr;
  let client: ChatClient;
  try { client = opts.client ?? llmClient(); } catch (e) {
    error.write(`✗ auth: ${escapeTerminalText((e as Error).message)}\n`);
    return 1;
  }
  const account = !!resolveApiKey();
  const policyCheck = opts.policyCheck ?? checkPolicy;
  let model = modelFlag || DEFAULT_MODEL;
  const history: ChatMsg[] = [];
  let spent = 0;

  output.write(`blockrun chat — model: ${escapeTerminalText(model)} (/model <id> to switch, /exit to quit)\n`);
  const rl = readline.createInterface({ input: opts.input ?? process.stdin, output, prompt: "you> " });
  let closed = false;
  rl.once("close", () => {
    closed = true;
  });
  const reprompt = () => {
    if (!closed) rl.prompt();
  };
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      reprompt();
      continue;
    }
    if (input === "/exit" || input === "/quit") {
      rl.close();
      break;
    }
    if (input.startsWith("/model")) {
      const next = input.split(/\s+/)[1];
      if (next) {
        model = next;
        output.write(`model → ${escapeTerminalText(model)}\n`);
      } else output.write(`model: ${escapeTerminalText(model)}\n`);
      reprompt();
      continue;
    }
    if (input === "/cost") {
      output.write(account ? `Account usage: ${PORTAL_URL}/dashboard/credits\n` : `session spend: ~$${spent.toFixed(4)}\n`);
      reprompt();
      continue;
    }

    const gate = policyCheck("chat");
    if (!gate.allowed) {
      error.write(`✗ policy: ${escapeTerminalText(gate.reason)}\n`);
      reprompt();
      continue;
    }

    history.push({ role: "user", content: input });
    try {
      const res = (await client.chatCompletion(model, history as never)) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_cost?: number };
      };
      const reply = res.choices?.[0]?.message?.content ?? "(empty reply)";
      if (typeof res.usage?.total_cost === "number") spent += res.usage.total_cost;
      history.push({ role: "assistant", content: reply });
      output.write(`${escapeTerminalText(reply)}\n`);
    } catch (e) {
      history.pop();
      error.write(`✗ ${escapeTerminalText((e as Error).message)}\n`);
    }
    reprompt();
  }
  return 0;
}
