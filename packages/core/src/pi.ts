import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PiRuntimeStatus {
  readonly rootPath: string;
  readonly installed: boolean;
  readonly configFiles: string[];
  readonly workflowFiles: string[];
  readonly adapterState: "not_connected" | "detected" | "ready_for_adapter";
  readonly nextActions: string[];
}

export async function inspectPiRuntime(input: { readonly homeDir?: string } = {}): Promise<PiRuntimeStatus> {
  const home = input.homeDir ?? homedir();
  const rootPath = join(home, ".pi");
  const installed = await exists(rootPath);
  if (!installed) {
    return {
      rootPath,
      installed: false,
      configFiles: [],
      workflowFiles: [],
      adapterState: "not_connected",
      nextActions: [
        "Install or point HybrowClaw at a pi.dev runtime.",
        "Keep HybrowClaw core independent until the adapter contract is stable.",
        "Use ContextObject + Trust Kernel traces as the boundary between pi flows and harness memory."
      ]
    };
  }

  const entries = await readdir(rootPath, { recursive: true }).catch(() => []);
  const files = entries.map(String);
  const configFiles = files.filter((file) => /(^|\/)(config|settings).*\.(json|ya?ml|toml)$/i.test(file));
  const workflowFiles = files.filter((file) => /(^|\/)(workflow|flow|agent|task).*\.(json|ya?ml|toml|ts|js|py)$/i.test(file));
  return {
    rootPath,
    installed,
    configFiles,
    workflowFiles,
    adapterState: configFiles.length || workflowFiles.length ? "ready_for_adapter" : "detected",
    nextActions: [
      "Map pi workflows to HybrowClaw FlowSpec.",
      "Wrap pi execution in a Trust Kernel run envelope.",
      "Persist pi outputs as scoped ContextObjects, never global memory by default.",
      "Add eval-gated promotion before any pi-derived memory is reused."
    ]
  };
}

export async function readPiCandidateFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}
