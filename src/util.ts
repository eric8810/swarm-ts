import { AgentFunction } from "./types";

export function debugPrint(debug: boolean, ...args: any[]): void {
  if (!debug) return;
  const timestamp = new Date().toISOString();
  const message = args.map(String).join(" ");
  console.log(
    `\x1b[97m[\x1b[90m${timestamp}\x1b[97m]\x1b[90m ${message}\x1b[0m`
  );
}

export function mergeFields(target: any, source: any): void {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      target[key] += value;
    } else if (value !== null && typeof value === "object") {
      mergeFields(target[key], value);
    }
  }
}

export function mergeChunk(finalResponse: any, delta: any): void {
  delete delta.role;
  mergeFields(finalResponse, delta);

  const toolCalls = delta.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const index = toolCalls[0].index;
    delete toolCalls[0].index;
    mergeFields(finalResponse.tool_calls[index], toolCalls[0]);
  }
}

export function functionToJson(func: AgentFunction): any {
  const typeMap: Record<string, string> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    object: "object",
    undefined: "null",
  };

  const funcStr = func.toString();
  const paramMatch = funcStr.match(/\(([^)]*)\)/);
  const params = paramMatch
    ? paramMatch[1].split(",").map((p) => p.trim())
    : [];

  const parameters: Record<string, any> = {};
  const required: string[] = [];

  params.forEach((param) => {
    const [name, defaultValue] = param.split("=").map((p) => p.trim());
    const type = typeMap[typeof eval(`(${defaultValue})`)];
    parameters[name] = { type };
    if (defaultValue === undefined) {
      required.push(name);
    }
  });

  return {
    type: "function",
    function: {
      name: func.name,
      description: func.description || "",
      parameters: {
        type: "object",
        properties: parameters,
        required,
      },
    },
  };
}
