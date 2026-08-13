export const OUTPUT_TOKEN_OPTIONS = [128, 256, 512, 1024] as const;
export const AUTOMATIC_OUTPUT_TOKENS = "automatic" as const;

export type OutputTokenLimit = (typeof OUTPUT_TOKEN_OPTIONS)[number];
export type OutputTokenSetting = OutputTokenLimit | typeof AUTOMATIC_OUTPUT_TOKENS;
export type InferenceTransport = "gateway" | "groq" | "v0" | "relay" | "mock";

export const DEFAULT_MAX_OUTPUT_TOKENS: OutputTokenLimit = 512;
export const MIN_MAX_OUTPUT_TOKENS = 32;
export const MAX_MAX_OUTPUT_TOKENS = 1024;

type InferenceOption = {
  transport: InferenceTransport;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  description: string;
  supportsOutputCap: boolean;
};

export const INFERENCE_OPTIONS = {
  "gateway-gpt-oss-120b": {
    transport: "gateway",
    providerLabel: "AI Gateway",
    modelId: "openai/gpt-oss-120b",
    modelLabel: "GPT-OSS 120B",
    description: "Gateway-routed baseline with cost-aware provider selection.",
    supportsOutputCap: true,
  },
  "gateway-grok-4.1-fast": {
    transport: "gateway",
    providerLabel: "AI Gateway",
    modelId: "xai/grok-4.1-fast-non-reasoning",
    modelLabel: "Grok 4.1 Fast",
    description: "Low-cost xAI model for fast conversational responses.",
    supportsOutputCap: true,
  },
  "gateway-gemini-2.5-flash-lite": {
    transport: "gateway",
    providerLabel: "AI Gateway",
    modelId: "google/gemini-2.5-flash-lite",
    modelLabel: "Gemini 2.5 Flash Lite",
    description: "Budget-oriented Google model with a large context window.",
    supportsOutputCap: true,
  },
  "gateway-claude-haiku-4.5": {
    transport: "gateway",
    providerLabel: "AI Gateway",
    modelId: "anthropic/claude-haiku-4.5",
    modelLabel: "Claude Haiku 4.5",
    description: "Budget-oriented Anthropic model for fast, capable responses.",
    supportsOutputCap: true,
  },
  "groq-direct-gpt-oss-120b": {
    transport: "groq",
    providerLabel: "Groq Direct",
    modelId: "openai/gpt-oss-120b",
    modelLabel: "GPT-OSS 120B",
    description: "Independent direct-Groq fallback using GROQ_API_KEY.",
    supportsOutputCap: true,
  },
  "v0-direct-mini": {
    transport: "v0",
    providerLabel: "v0 Direct",
    modelId: "v0-mini",
    modelLabel: "v0 Mini",
    description: "Lowest-cost current v0 model for fast web-development tasks.",
    supportsOutputCap: false,
  },
  "v0-direct-pro": {
    transport: "v0",
    providerLabel: "v0 Direct",
    modelId: "v0-pro",
    modelLabel: "v0 Pro",
    description: "Balanced v0 model for more capable web-development work.",
    supportsOutputCap: false,
  },
  "chatgpt-relay": {
    transport: "relay",
    providerLabel: "ChatGPT Relay",
    modelId: "chatgpt/instant",
    modelLabel: "Instant",
    description: "Local signed-in browser relay for private prototyping.",
    supportsOutputCap: false,
  },
  mock: {
    transport: "mock",
    providerLabel: "Mock",
    modelId: "simulated",
    modelLabel: "Simulated",
    description: "Local deterministic responses with no model usage.",
    supportsOutputCap: false,
  },
} as const satisfies Record<string, InferenceOption>;

export type InferenceOptionId = keyof typeof INFERENCE_OPTIONS;

export const DEFAULT_INFERENCE_OPTION_ID: InferenceOptionId = "v0-direct-mini";

export const INFERENCE_OPTION_GROUPS: ReadonlyArray<{
  label: string;
  optionIds: readonly InferenceOptionId[];
}> = [
  {
    label: "v0 credits",
    optionIds: ["v0-direct-mini", "v0-direct-pro"],
  },
  {
    label: "Vercel AI Gateway",
    optionIds: [
      "gateway-gpt-oss-120b",
      "gateway-grok-4.1-fast",
      "gateway-gemini-2.5-flash-lite",
      "gateway-claude-haiku-4.5",
    ],
  },
  {
    label: "Backup paths",
    optionIds: ["groq-direct-gpt-oss-120b", "chatgpt-relay"],
  },
  {
    label: "Development",
    optionIds: ["mock"],
  },
];

export function isInferenceOptionId(value: unknown): value is InferenceOptionId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INFERENCE_OPTIONS, value);
}

export function normalizeMaxOutputTokens(value: unknown): number | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.min(
    MAX_MAX_OUTPUT_TOKENS,
    Math.max(MIN_MAX_OUTPUT_TOKENS, Math.floor(value)),
  );
}

export function modelLabelForId(modelId: string): string {
  const option = Object.values(INFERENCE_OPTIONS).find((candidate) => candidate.modelId === modelId);
  return option?.modelLabel ?? modelId;
}
