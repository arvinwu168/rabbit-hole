import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INFERENCE_OPTION_ID,
  DEFAULT_MAX_OUTPUT_TOKENS,
  INFERENCE_OPTION_GROUPS,
  INFERENCE_OPTIONS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  isInferenceOptionId,
  modelLabelForId,
  normalizeMaxOutputTokens,
} from "../lib/inference-options.ts";
import {
  resolveExperimentModeAvailability,
  resolveExperimentModeEnabled,
} from "../lib/experiment-mode.ts";

test("the catalog exposes four Gateway models and independent backup paths", () => {
  const gatewayOptions = Object.values(INFERENCE_OPTIONS).filter(
    (option) => option.transport === "gateway",
  );

  assert.equal(gatewayOptions.length, 4);
  assert.deepEqual(
    gatewayOptions.map((option) => option.modelId),
    [
      "openai/gpt-oss-120b",
      "xai/grok-4.1-fast-non-reasoning",
      "google/gemini-2.5-flash-lite",
      "anthropic/claude-haiku-4.5",
    ],
  );
  assert.equal(INFERENCE_OPTIONS["groq-direct-gpt-oss-120b"].transport, "groq");
  assert.equal(INFERENCE_OPTIONS["v0-direct-mini"].transport, "v0");
  assert.equal(INFERENCE_OPTIONS["v0-direct-pro"].transport, "v0");
  assert.equal(INFERENCE_OPTIONS["v0-direct-mini"].supportsOutputCap, false);
  assert.equal(INFERENCE_OPTIONS["chatgpt-relay"].transport, "relay");
  assert.equal(INFERENCE_OPTIONS.mock.transport, "mock");
  assert.equal(DEFAULT_INFERENCE_OPTION_ID, "v0-direct-mini");
  assert.equal(INFERENCE_OPTIONS[DEFAULT_INFERENCE_OPTION_ID].transport, "v0");
});

test("output token limits support automatic mode, floor, and clamp on the server", () => {
  assert.equal(normalizeMaxOutputTokens(undefined), undefined);
  assert.equal(normalizeMaxOutputTokens(Number.NaN), DEFAULT_MAX_OUTPUT_TOKENS);
  assert.equal(normalizeMaxOutputTokens(12), MIN_MAX_OUTPUT_TOKENS);
  assert.equal(normalizeMaxOutputTokens(256.9), 256);
  assert.equal(normalizeMaxOutputTokens(50_000), MAX_MAX_OUTPUT_TOKENS);
});

test("catalog IDs and display labels are resolved from the shared registry", () => {
  assert.equal(isInferenceOptionId("gateway-gpt-oss-120b"), true);
  assert.equal(isInferenceOptionId("gateway-arbitrary-model"), false);
  assert.equal(modelLabelForId("xai/grok-4.1-fast-non-reasoning"), "Grok 4.1 Fast");
  assert.equal(modelLabelForId("unknown/model"), "unknown/model");

  const groupedIds = INFERENCE_OPTION_GROUPS.flatMap((group) => group.optionIds);
  assert.equal(new Set(groupedIds).size, groupedIds.length);
  assert.deepEqual(new Set(groupedIds), new Set(Object.keys(INFERENCE_OPTIONS)));
});

test("the experiment mode toggle is always available", () => {
  assert.equal(resolveExperimentModeAvailability(), true);
});

test("experiment mode defaults on but preserves an explicit off choice", () => {
  assert.equal(resolveExperimentModeEnabled(null), true);
  assert.equal(resolveExperimentModeEnabled("true"), true);
  assert.equal(resolveExperimentModeEnabled("false"), false);
  assert.equal(resolveExperimentModeEnabled("unexpected"), true);
});
