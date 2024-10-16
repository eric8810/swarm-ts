import { OpenAI } from "openai";
import {
  Agent,
  AgentFunction,
  ChatCompletionMessage,
  ChatCompletionMessageToolCall,
  Response,
  Result,
} from "./types";
import { functionToJson, debugPrint, mergeChunk } from "./util";

const __CTX_VARS_NAME__ = "context_variables";

export class Swarm {
  private client: OpenAI;

  constructor(client: OpenAI) {
    this.client = client;
  }

  private async getChatCompletion(
    agent: Agent,
    history: ChatCompletionMessage[],
    contextVariables: Record<string, any>,
    modelOverride: string | null,
    stream: boolean,
    debug: boolean
  ): Promise<any> {
    const instructions =
      typeof agent.instructions === "function"
        ? agent.instructions(contextVariables)
        : agent.instructions;

    const messages = [{ role: "system", content: instructions }, ...history];
    debugPrint(debug, "Getting chat completion for...:", messages);

    const tools = agent.functions.map((f) => functionToJson(f));
    // hide context_variables from model
    for (const tool of tools) {
      const params = tool.function.parameters;
      delete params.properties[__CTX_VARS_NAME__];
      if (params.required && params.required.includes(__CTX_VARS_NAME__)) {
        params.required = params.required.filter(
          (r: string) => r !== __CTX_VARS_NAME__
        );
      }
    }

    const createParams: any = {
      model: modelOverride || agent.model,
      messages,
      functions: tools.length > 0 ? tools : undefined,
      function_call: agent.toolChoice,
      stream,
    };

    if (tools.length > 0) {
      createParams.parallel_tool_calls = agent.parallelToolCalls;
    }

    return this.client.chat.completions.create(createParams);
  }

  private handleFunctionResult(result: any, debug: boolean): Result {
    if (result instanceof Result) {
      return result;
    }

    if (result instanceof Agent) {
      return new Result({
        value: JSON.stringify({ assistant: result.name }),
        agent: result,
      });
    }

    try {
      return new Result({ value: String(result) });
    } catch (e) {
      const errorMessage = `Failed to cast response to string: ${result}. Make sure agent functions return a string or Result object. Error: ${e}`;
      debugPrint(debug, errorMessage);
      throw new TypeError(errorMessage);
    }
  }

  private handleToolCalls(
    toolCalls: ChatCompletionMessageToolCall[],
    functions: AgentFunction[],
    contextVariables: Record<string, any>,
    debug: boolean
  ): Response {
    const functionMap = new Map(functions.map((f) => [f.name, f]));
    const partialResponse = new Response();

    for (const toolCall of toolCalls) {
      const name = toolCall.function.name;
      if (!functionMap.has(name)) {
        debugPrint(debug, `Tool ${name} not found in function map.`);
        partialResponse.messages.push({
          role: "function",
          name: name,
          content: `Error: Tool ${name} not found.`,
        });
        continue;
      }

      const args = JSON.parse(toolCall.function.arguments);
      debugPrint(debug, `Processing tool call: ${name} with arguments ${args}`);

      const func = functionMap.get(name)!;
      if (func.length > 0 && func.toString().includes(__CTX_VARS_NAME__)) {
        args[__CTX_VARS_NAME__] = contextVariables;
      }

      const rawResult = func(args);
      const result = this.handleFunctionResult(rawResult, debug);

      partialResponse.messages.push({
        role: "function",
        name: name,
        content: result.value,
      });

      partialResponse.contextVariables = {
        ...partialResponse.contextVariables,
        ...result.contextVariables,
      };

      if (result.agent) {
        partialResponse.agent = result.agent;
      }
    }

    return partialResponse;
  }

  public async *runAndStream(
    agent: Agent,
    messages: ChatCompletionMessage[],
    contextVariables: Record<string, any> = {},
    modelOverride: string | null = null,
    debug: boolean = false,
    maxTurns: number = Infinity,
    executeTools: boolean = true
  ): AsyncGenerator<any, void, unknown> {
    let activeAgent = agent;
    const history = [...messages];
    const initLen = messages.length;

    while (history.length - initLen < maxTurns) {
      const message: any = {
        content: "",
        sender: agent.name,
        role: "assistant",
        function_call: null,
        tool_calls: {},
      };

      const completion = await this.getChatCompletion(
        activeAgent,
        history,
        contextVariables,
        modelOverride,
        true,
        debug
      );

      yield { delim: "start" };
      for await (const chunk of completion.data as any) {
        const delta = JSON.parse(chunk.choices[0].delta);
        if (delta.role === "assistant") {
          delta.sender = activeAgent.name;
        }
        yield delta;
        delete delta.role;
        delete delta.sender;
        mergeChunk(message, delta);
      }
      yield { delim: "end" };

      message.tool_calls = Object.values(message.tool_calls);
      if (message.tool_calls.length === 0) {
        message.tool_calls = null;
      }
      debugPrint(debug, "Received completion:", message);
      history.push(message);

      if (!message.tool_calls || !executeTools) {
        debugPrint(debug, "Ending turn.");
        break;
      }

      const toolCalls = message.tool_calls.map((toolCall: any) => ({
        id: toolCall.id,
        function: {
          arguments: toolCall.function.arguments,
          name: toolCall.function.name,
        },
        type: toolCall.type,
      }));

      const partialResponse = this.handleToolCalls(
        toolCalls,
        activeAgent.functions,
        contextVariables,
        debug
      );
      history.push(...partialResponse.messages);
      contextVariables = {
        ...contextVariables,
        ...partialResponse.contextVariables,
      };
      if (partialResponse.agent) {
        activeAgent = partialResponse.agent;
      }
    }

    yield {
      response: new Response({
        messages: history.slice(initLen),
        agent: activeAgent,
        contextVariables,
      }),
    };
  }

  public async run(
    agent: Agent,
    messages: ChatCompletionMessage[],
    contextVariables: Record<string, any> = {},
    modelOverride: string | null = null,
    stream: boolean = false,
    debug: boolean = false,
    maxTurns: number = Infinity,
    executeTools: boolean = true
  ): Promise<Response | AsyncGenerator<any, void, unknown>> {
    if (stream) {
      return this.runAndStream(
        agent,
        messages,
        contextVariables,
        modelOverride,
        debug,
        maxTurns,
        executeTools
      );
    }

    let activeAgent = agent;
    const history = [...messages];
    const initLen = messages.length;

    while (history.length - initLen < maxTurns && activeAgent) {
      const completion = await this.getChatCompletion(
        activeAgent,
        history,
        contextVariables,
        modelOverride,
        stream,
        debug
      );

      const message = completion.data.choices[0].message;
      debugPrint(debug, "Received completion:", message);
      message.sender = activeAgent.name;
      history.push(JSON.parse(JSON.stringify(message)));

      if (!message.tool_calls || !executeTools) {
        debugPrint(debug, "Ending turn.");
        break;
      }

      const partialResponse = this.handleToolCalls(
        message.tool_calls,
        activeAgent.functions,
        contextVariables,
        debug
      );
      history.push(...partialResponse.messages);
      contextVariables = {
        ...contextVariables,
        ...partialResponse.contextVariables,
      };
      if (partialResponse.agent) {
        activeAgent = partialResponse.agent;
      }
    }

    return new Response({
      messages: history.slice(initLen),
      agent: activeAgent,
      contextVariables,
    });
  }
}
