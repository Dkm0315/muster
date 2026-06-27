import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCapabilityPack, type CapabilityPackInspection } from "./capability.js";
import type { RuntimeDoctorStatus } from "./runtime-doctor.js";

export interface QaPackReadinessCase {
  readonly id: string;
  readonly status: RuntimeDoctorStatus;
  readonly summary: string;
  readonly evidence: Record<string, unknown>;
}

export interface QaPackReadinessResult {
  readonly suite: "pack_readiness";
  readonly status: RuntimeDoctorStatus;
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly casesPath: string;
  readonly catalogPath: string;
  readonly cases: readonly QaPackReadinessCase[];
  readonly summary: string;
}

export async function runPackReadinessQa(input: {
  readonly artifactDir: string;
  readonly packsDir?: string;
}): Promise<QaPackReadinessResult> {
  const artifactDir = input.artifactDir;
  const packsDir = input.packsDir ?? defaultBundledPacksDir();
  await mkdir(artifactDir, { recursive: true });

  const inspections = await inspectBundledPacks(packsDir);
  const cases: QaPackReadinessCase[] = [
    caseAllManifestsParse(inspections),
    caseReadinessMetadataVisible(inspections),
    caseImplementedToolSurfacesVisible(inspections),
    caseNoReleaseReadyWithoutEvidence(inspections),
    caseHighRiskHasSecretsAndPolicy(inspections),
    caseDeclaredEvalsAreVisible(inspections),
  ];

  const status: RuntimeDoctorStatus = cases.some((item) => item.status === "failed")
    ? "failed"
    : cases.some((item) => item.status === "warning")
      ? "warning"
      : "passed";
  const summary = status === "passed"
    ? "Capability pack readiness metadata and release claims are consistent"
    : "Capability pack readiness needs metadata or evidence hardening";
  const manifestPath = join(artifactDir, "manifest.json");
  const casesPath = join(artifactDir, "cases.jsonl");
  const catalogPath = join(artifactDir, "catalog.json");

  await writeFile(casesPath, `${cases.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  await writeFile(catalogPath, `${JSON.stringify(inspections.map(snapshotInspection), null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "muster-qa",
    suite: "pack_readiness",
    status,
    summary,
    caseCount: cases.length,
    artifacts: { cases: "cases.jsonl", catalog: "catalog.json" },
  }, null, 2)}\n`, "utf8");

  return { suite: "pack_readiness", status, artifactDir, manifestPath, casesPath, catalogPath, cases, summary };
}

function defaultBundledPacksDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "capability-packs");
}

async function inspectBundledPacks(packsDir: string): Promise<CapabilityPackInspection[]> {
  const entries = await readdir(packsDir, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => join(packsDir, entry.name)).sort();
  const inspections: CapabilityPackInspection[] = [];
  for (const dir of dirs) {
    if (!existsSync(join(dir, "manifest.json")) && !existsSync(join(dir, "muster.capability.json"))) continue;
    inspections.push(await inspectCapabilityPack(dir));
  }
  return inspections;
}

function caseAllManifestsParse(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const blocked = inspections.filter((item) => item.status === "blocked");
  if (!inspections.length) {
    return {
      id: "all_manifests_parse",
      status: "failed",
      summary: "no bundled capability packs were found",
      evidence: { packCount: 0, blocked: [] },
    };
  }
  return {
    id: "all_manifests_parse",
    status: blocked.length ? "failed" : "passed",
    summary: blocked.length ? "one or more bundled capability manifests are blocked" : "all bundled capability manifests parse",
    evidence: { packCount: inspections.length, blocked: blocked.map((item) => ({ path: item.path, blockers: item.blockers })) },
  };
}

function caseReadinessMetadataVisible(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const missing = inspections.filter((item) => item.manifest && !item.manifest.readiness).map((item) => item.manifest!.id);
  return {
    id: "readiness_metadata_visible",
    status: missing.length ? "warning" : "passed",
    summary: missing.length ? "some packs still rely on legacy manifests without readiness metadata" : "all packs expose readiness metadata",
    evidence: { missing },
  };
}

function caseImplementedToolSurfacesVisible(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const missing = inspections
    .filter((item) => item.manifest && !(item.manifest.implementedTools?.length))
    .map((item) => item.manifest!.id);
  const shallow = inspections
    .filter((item) => item.manifest?.readiness?.level !== "listed")
    .filter((item) => item.manifest?.readiness?.actionability !== "metadata")
    .filter((item) => item.manifest && (item.manifest.implementedTools?.length ?? 0) < 1)
    .map((item) => item.manifest!.id);
  const channelWithoutGateway = inspections
    .filter((item) => item.manifest?.kind === "channel")
    .filter((item) => {
      const surfaces = item.manifest?.readiness?.surfaces ?? [];
      return !surfaces.includes("channel") || !surfaces.includes("gateway");
    })
    .map((item) => item.manifest!.id);
  const offenders = [...new Set([...missing, ...shallow, ...channelWithoutGateway])].sort();
  return {
    id: "implemented_tool_surfaces_visible",
    status: offenders.length ? "failed" : "passed",
    summary: offenders.length
      ? "some non-metadata packs are missing implemented tool or channel/gateway surface evidence"
      : "all bundled non-metadata packs declare implemented tools and channel gateway surfaces",
    evidence: {
      missingImplementedTools: missing,
      shallowNonMetadataPacks: shallow,
      channelWithoutGatewaySurface: channelWithoutGateway,
      toolCounts: inspections
        .filter((item) => item.manifest)
        .map((item) => ({ id: item.manifest!.id, tools: item.manifest!.implementedTools?.length ?? 0 })),
    },
  };
}

function caseNoReleaseReadyWithoutEvidence(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const offenders = inspections
    .filter((item) => item.manifest?.readiness?.level === "release_ready")
    .filter((item) => {
      const evidence = item.manifest?.readiness?.evidence;
      return !(evidence?.qaSuites?.length && evidence.docs?.length);
    })
    .map((item) => item.manifest!.id);
  return {
    id: "no_release_ready_without_evidence",
    status: offenders.length ? "failed" : "passed",
    summary: offenders.length ? "release-ready packs are missing QA/doc evidence" : "no pack claims release-ready without evidence",
    evidence: { offenders },
  };
}

function caseHighRiskHasSecretsAndPolicy(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const offenders = inspections
    .filter((item) => item.risk === "high")
    .filter((item) => item.manifest && item.manifest.permissions.includes("secrets") && !(item.manifest.secrets?.length))
    .map((item) => item.manifest!.id);
  return {
    id: "high_risk_has_secrets_and_policy",
    status: offenders.length ? "failed" : "passed",
    summary: offenders.length ? "high-risk secret-using packs are missing declared secrets" : "high-risk secret-using packs declare secrets",
    evidence: { offenders },
  };
}

function caseDeclaredEvalsAreVisible(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const missing = inspections
    .filter((item) => item.manifest?.evals?.length)
    .flatMap((item) => item.manifest!.evals!.filter((evalPath) => !existsSync(join(item.path, evalPath))).map((evalPath) => `${item.manifest!.id}:${evalPath}`));
  return {
    id: "declared_evals_are_visible",
    status: missing.length ? "warning" : "passed",
    summary: missing.length ? "some declared eval paths are not present yet" : "declared eval paths are present",
    evidence: { missing },
  };
}

function snapshotInspection(item: CapabilityPackInspection): Record<string, unknown> {
  return {
    path: item.path,
    status: item.status,
    risk: item.risk,
    blockers: item.blockers,
    warnings: item.warnings,
    manifest: item.manifest ? {
      id: item.manifest.id,
      kind: item.manifest.kind,
      permissions: item.manifest.permissions,
      sandbox: item.manifest.sandbox,
      implementedTools: item.manifest.implementedTools ?? [],
      readiness: item.manifest.readiness ?? null,
    } : null,
  };
}
