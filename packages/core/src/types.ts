export type RuntimeKind = "native" | "codex" | "claude-code" | "cursor-sdk" | "openhands" | "pi";

export type TaskKind =
  | "simple_qa"
  | "research"
  | "architecture"
  | "coding"
  | "debugging"
  | "artifact"
  | "private_analysis"
  | "workflow";

export type ReasoningLevel = "none" | "low" | "medium" | "high";

export type ProviderKind =
  | "openai-compatible"
  | "openai"
  | "anthropic"
  | "google"
  | "azure-openai"
  | "bedrock"
  | "local"
  | "codex-cli";

export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
  readonly reasoning?: ReasoningLevel;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
}

export interface ProviderConfig {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly defaultModel: string;
  readonly timeoutMs?: number;
}

export interface RuntimeConfig {
  readonly id: RuntimeKind | string;
  readonly enabled: boolean;
  readonly provider: string;
  readonly routes: Partial<Record<TaskKind, ModelRoute>>;
}

export interface RoutingPolicy {
  readonly oneRuntimePerRun: true;
  readonly defaultRuntime: string;
  readonly preferLocalForSensitive: boolean;
  readonly maxCostUsdPerRun?: number;
  readonly approvalRequiredAboveUsd?: number;
  /**
   * Governed fallback routes tried in order when the primary route fails.
   * Every fallback attempt is recorded as system_check evidence on the episode;
   * the harness never switches models silently.
   */
  readonly fallbacks?: ModelRoute[];
}

export interface MusterConfig {
  readonly version: 1;
  readonly providers: Record<string, ProviderConfig>;
  readonly runtimes: Record<string, RuntimeConfig>;
  readonly routing: RoutingPolicy;
}

export interface RunRequest {
  readonly prompt: string;
  readonly runtime?: string;
  readonly taskKind?: TaskKind;
  readonly sensitive?: boolean;
  readonly cwd?: string;
}

export interface RunPlan {
  readonly runId: string;
  readonly taskKind: TaskKind;
  readonly runtimeId: string;
  readonly route: ModelRoute;
  readonly sensitive: boolean;
  readonly createdAt: string;
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface EpisodeRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly taskKind: TaskKind;
  readonly runtimeId: string;
  readonly providerId: string;
  readonly model: string;
  readonly reasoning?: ReasoningLevel;
  readonly responseText: string;
  readonly evidence: EvidenceRecord[];
  readonly outcome?: OutcomeSignal;
}

export interface EvidenceRecord {
  readonly kind: "model_response" | "tool_result" | "test_result" | "user_action" | "system_check";
  readonly label: string;
  readonly status: "observed" | "passed" | "failed" | "unknown";
  readonly detail?: string;
}

export interface OutcomeSignal {
  readonly kind: "completed" | "failed" | "abandoned" | "unknown";
  readonly detail?: string;
}

export type FeedbackValue = "useful" | "not_useful";

export interface FeedbackInput {
  readonly episodeId: string;
  readonly value: FeedbackValue;
  readonly reason?: string;
  readonly correctAndWorked?: boolean;
}

export type FeedbackAdjudication =
  | "verified_success"
  | "verified_failure"
  | "user_disputed_evidence_correct"
  | "intent_mismatch"
  | "poor_explanation"
  | "retrieval_or_tool_failure"
  | "model_hallucination"
  | "insufficient_evidence"
  | "likely_unjustified_feedback"
  | "needs_expert_review";

export interface FeedbackRecord extends FeedbackInput {
  readonly createdAt: string;
  readonly adjudication: FeedbackAdjudication;
  readonly learningCandidates: LearningCandidate[];
}

export interface LearningCandidate {
  readonly kind: "memory" | "eval" | "policy" | "tool_fix" | "prompt_or_routing";
  readonly risk: "low" | "medium" | "high";
  readonly summary: string;
  readonly autoApply: boolean;
}

export type MemoryScopeKind = "global" | "tenant" | "workspace" | "user" | "pairing" | "session" | "role" | "persona";

export interface MemoryScope {
  readonly kind: MemoryScopeKind;
  readonly id: string;
}

export interface ContextObject {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly sourceUri?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly observedAt: string;
  readonly confidence: number;
  readonly provenance: string[];
  readonly scopes: MemoryScope[];
  readonly redactionState: "none" | "redacted" | "hashed" | "blocked";
  readonly feedbackScore?: number;
  readonly links?: string[];
}
