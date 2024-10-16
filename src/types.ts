import { ChatCompletionMessageToolCall } from "openai/resources";

export type AgentFunction = {
  (...args: any[]): string | Agent | Record<string, any>;
  description?: string;
};

export class Agent {
  name: string = "Agent";
  model: string = "gpt-4";
  instructions: string | ((contextVariables: Record<string, any>) => string) =
    "You are a helpful agent.";
  functions: AgentFunction[] = [];
  toolChoice: string | null = null;
  parallelToolCalls: boolean = true;
}

export class Response {
  messages: ChatCompletionMessage[] = [];
  agent: Agent | null = null;
  contextVariables: Record<string, any> = {};

  constructor(data: Partial<Response> = {}) {
    Object.assign(this, data);
  }
}

export class Result {
  value: string = "";
  agent: Agent | null = null;
  contextVariables: Record<string, any> = {};

  constructor(data: Partial<Result> = {}) {
    Object.assign(this, data);
  }
}

export { ChatCompletionMessageToolCall };

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "function";
  content: string | null;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}
