import { access, link, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const JOURNAL_PREFIX = ".openfad-motion-transaction.";
const JOURNAL_SUFFIX = ".json";
const GROUP_JOURNAL_PREFIX = ".openfad-motion-output-group.";
const GROUP_JOURNAL_SUFFIX = ".json";
const JOURNAL_OWNER = "openfad-motion-batch";
const MANAGED_JOURNAL_STALE_MS = 30_000;

export function buildAtomicOutput(finalPath) {
  const directory = path.dirname(finalPath);
  const filename = path.basename(finalPath);
  const extension = path.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  return {
    final: finalPath,
    temp: path.join(directory, `.${stem}.${token}.tmp${extension}`),
    backup: path.join(directory, `.${stem}.${token}.bak${extension}`),
    journal: path.join(directory, `${JOURNAL_PREFIX}${token}${JOURNAL_SUFFIX}`),
    token,
    hadExistingFinal: false,
    finalized: false,
    phase: "unstarted"
  };
}

export async function commitAtomicOutput(output, { overwrite, label = "Output" }) {
  if (!output) return;
  if (!overwrite) {
    output.hadExistingFinal = false;
    output.phase = "ready-to-promote";
    await writeTransactionJournal(output);
    try {
      await link(output.temp, output.final);
      output.phase = "final-replaced";
      await writeTransactionJournal(output);
      await rm(output.temp, { force: true });
    } catch (error) {
      await restoreCommittedOutput(output);
      if (error.code === "EEXIST") {
        const overwriteHint = label === "Report" ? "Enable overwrite" : "Use --overwrite";
        throw new Error(`${label} already exists: ${output.final}. ${overwriteHint} only when replacing it is intentional.`);
      }
      throw error;
    }
    return;
  }

  output.hadExistingFinal = await inspectExistingFinal(output, { label });
  output.phase = "started";
  await writeTransactionJournal(output);
  try {
    if (output.hadExistingFinal) {
      await rename(output.final, output.backup);
      output.phase = "backup-created";
      await writeTransactionJournal(output);
    } else {
      output.phase = "ready-to-promote";
      await writeTransactionJournal(output);
    }
    await rename(output.temp, output.final);
    output.phase = "final-replaced";
    await writeTransactionJournal(output);
  } catch (error) {
    await restoreCommittedOutput(output);
    throw error;
  }
}

export async function cleanupAtomicOutput(output) {
  if (!output) return;
  await rm(output.temp, { force: true });
}

export async function cleanupAtomicOutputs(outputs) {
  for (const output of outputs) {
    await cleanupAtomicOutput(output);
  }
}

export async function cleanupCommittedOutputs(outputs) {
  for (const output of outputs.toReversed()) {
    await restoreCommittedOutput(output);
  }
}

export async function finalizeCommittedOutputs(outputs) {
  for (const output of outputs) {
    if (output.journal) {
      await writeTransactionJournal({ ...output, phase: "finalized", finalized: true });
    }
    await cleanupFinalizedOutput(output);
  }
}

export async function finalizeCommittedOutputGroup(outputs) {
  const committedOutputs = outputs.filter(Boolean);
  if (committedOutputs.length === 0) return;

  const directory = assertSingleOutputDirectory(committedOutputs);
  const group = buildOutputGroupJournal(directory, committedOutputs);
  try {
    await writeOutputGroupJournal(group);
    group.phase = "finalized";
    group.finalized = true;
    group.outputs = committedOutputs.map((output) => ({
      ...snapshotOutput(output),
      phase: "finalized",
      finalized: true
    }));
    await writeOutputGroupJournal(group);
  } catch (error) {
    await removeTransactionJournal(group.journal);
    throw error;
  }

  for (const output of committedOutputs) {
    await cleanupFinalizedOutput(output);
  }
  await removeTransactionJournal(group.journal);
}

export async function recoverOutputTransactions(directory, { excludeJournals = [], allowedFinals = null } = {}) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const excluded = new Set(excludeJournals.map((journal) => path.resolve(journal)));
  const allowedFinalPaths = allowedFinals
    ? new Set(allowedFinals.map((finalPath) => recoveryPathKey(finalPath)))
    : null;
  const { recovered, protectedJournals } = await recoverOutputGroups(directory, entries, { excluded, allowedFinalPaths });
  for (const journal of protectedJournals) {
    excluded.add(journal);
  }
  for (const entry of entries) {
    if (!entry.isFile() || !isTransactionJournalName(entry.name)) continue;
    const journal = path.join(directory, entry.name);
    if (excluded.has(path.resolve(journal))) continue;
    const output = await readTransactionJournal(journal, directory, { allowedFinalPaths });
    if (!output) continue;
    if (output.finalized || output.phase === "finalized") {
      await rm(output.backup, { force: true });
      await rm(output.temp, { force: true });
      await removeTransactionJournal(output.journal);
      recovered.push({ journal, action: "finalized" });
      continue;
    }
    await restoreStandaloneOutputSafely(output);
    recovered.push({ journal, action: "rolled-back" });
  }
  return recovered;
}

async function recoverOutputGroups(directory, entries, { excluded, allowedFinalPaths }) {
  const recovered = [];
  const protectedJournals = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || !isOutputGroupJournalName(entry.name)) continue;
    const journal = path.join(directory, entry.name);
    const group = await readOutputGroupJournal(journal, directory, { allowedFinalPaths });
    if (!group) continue;
    if (group.outputs.some((output) => excluded.has(path.resolve(output.journal)))) {
      for (const output of group.outputs) {
        protectedJournals.add(path.resolve(output.journal));
      }
      continue;
    }
    if (group.finalized || group.phase === "finalized") {
      for (const output of group.outputs) {
        await cleanupFinalizedOutput(output);
      }
      await removeTransactionJournal(group.journal);
      recovered.push({ journal, action: "group-finalized" });
      continue;
    }
    await assertOutputGroupRollbackSafe(group);
    for (const output of group.outputs.toReversed()) {
      await restoreCommittedOutput(output);
    }
    await removeTransactionJournal(group.journal);
    recovered.push({ journal, action: "group-rolled-back" });
  }
  return { recovered, protectedJournals };
}

async function assertOutputGroupRollbackSafe(group) {
  for (const output of group.outputs) {
    if (!requiresExistingBackupForRollback(output)) continue;
    if (!await fileExists(output.backup)) {
      throw new Error(`Cannot safely roll back output group ${group.journal}: missing backup for ${output.final}.`);
    }
  }
}

async function restoreStandaloneOutputSafely(output) {
  if (requiresExistingBackupForRollback(output) && !await fileExists(output.backup)) {
    throw new Error(`Cannot safely roll back output transaction ${output.journal}: missing backup for ${output.final}.`);
  }
  await restoreCommittedOutput(output);
}

function requiresExistingBackupForRollback(output) {
  if (!output.hadExistingFinal || output.finalized) return false;
  const phase = output.phase ?? "final-replaced";
  return phase !== "started";
}

async function inspectExistingFinal(output, { label }) {
  try {
    const info = await stat(output.final);
    if (!info.isFile()) {
      throw new Error(`${label} path is not a file and cannot be overwritten safely: ${output.final}`);
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function restoreCommittedOutput(output) {
  if (!output || output.finalized) return;
  const phase = output.phase ?? "final-replaced";
  if (phase === "started") {
    await rm(output.temp, { force: true });
    if (output.hadExistingFinal && !await fileExists(output.final) && await fileExists(output.backup)) {
      await rename(output.backup, output.final);
    } else {
      await rm(output.backup, { force: true });
    }
    output.hadExistingFinal = false;
    await removeTransactionJournal(output.journal);
    return;
  }

  if (phase === "ready-to-promote" && !output.hadExistingFinal && await fileExists(output.temp)) {
    if (await isSameFile(output.temp, output.final)) {
      await rm(output.final, { force: true });
    }
    await rm(output.temp, { force: true });
    await rm(output.backup, { force: true });
    await removeTransactionJournal(output.journal);
    return;
  }

  await rm(output.final, { force: true });
  if (output.hadExistingFinal && await fileExists(output.backup)) {
    await rename(output.backup, output.final);
  }
  await rm(output.temp, { force: true });
  await removeTransactionJournal(output.journal);
  output.hadExistingFinal = false;
}

async function cleanupFinalizedOutput(output) {
  if (output.hadExistingFinal) {
    await rm(output.backup, { force: true });
    output.hadExistingFinal = false;
  }
  await rm(output.temp, { force: true });
  await removeTransactionJournal(output.journal);
  output.phase = "finalized";
  output.finalized = true;
}

async function writeTransactionJournal(output) {
  if (!output.journal) return;
  const payload = {
    version: 1,
    owner: JOURNAL_OWNER,
    token: output.token ?? extractJournalToken(output.journal, JOURNAL_PREFIX, JOURNAL_SUFFIX),
    updatedAt: new Date().toISOString(),
    final: output.final,
    temp: output.temp,
    backup: output.backup,
    hadExistingFinal: Boolean(output.hadExistingFinal),
    phase: output.phase,
    finalized: Boolean(output.finalized)
  };
  await writeJsonAtomically(output.journal, payload);
}

function buildOutputGroupJournal(directory, outputs) {
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  return {
    journal: path.join(directory, `${GROUP_JOURNAL_PREFIX}${token}${GROUP_JOURNAL_SUFFIX}`),
    token,
    phase: "pending",
    finalized: false,
    outputs: outputs.map(snapshotOutput)
  };
}

async function writeOutputGroupJournal(group) {
  const payload = {
    version: 1,
    owner: JOURNAL_OWNER,
    token: group.token ?? extractJournalToken(group.journal, GROUP_JOURNAL_PREFIX, GROUP_JOURNAL_SUFFIX),
    updatedAt: new Date().toISOString(),
    phase: group.phase,
    finalized: Boolean(group.finalized),
    outputs: group.outputs.map(snapshotOutput)
  };
  await writeJsonAtomically(group.journal, payload);
}

async function readTransactionJournal(journal, directory, { allowedFinalPaths = null } = {}) {
  const payload = await readJournalPayload(journal, "output transaction");
  if (!payload) return null;

  const output = {
    final: path.resolve(String(payload.final ?? "")),
    temp: path.resolve(String(payload.temp ?? "")),
    backup: path.resolve(String(payload.backup ?? "")),
    journal,
    hadExistingFinal: Boolean(payload.hadExistingFinal),
    phase: String(payload.phase ?? "started"),
    finalized: Boolean(payload.finalized)
  };
  const root = path.resolve(directory);
  if (![output.final, output.temp, output.backup].every((candidate) => path.dirname(candidate) === root)) {
    return null;
  }
  if (allowedFinalPaths && !allowedFinalPaths.has(recoveryPathKey(output.final))) {
    return null;
  }
  if (!hasExpectedAuxiliaryName(output.final, output.temp, ".tmp") || !hasExpectedAuxiliaryName(output.final, output.backup, ".bak")) {
    throw new Error(`Unsafe output transaction journal ${journal}: temp and backup names must match ${path.basename(output.final)}.`);
  }
  if (allowedFinalPaths && !isRecoverableManagedJournal(payload, journal, {
    prefix: JOURNAL_PREFIX,
    suffix: JOURNAL_SUFFIX,
    final: output.final,
    temp: output.temp,
    backup: output.backup
  })) {
    return null;
  }
  return output;
}

async function readOutputGroupJournal(journal, directory, { allowedFinalPaths = null } = {}) {
  const payload = await readJournalPayload(journal, "output group");
  if (!payload) return null;

  if (!Array.isArray(payload.outputs) || payload.outputs.length === 0) {
    throw new Error(`Invalid output group journal ${journal}: outputs must be a non-empty array.`);
  }
  const outputs = payload.outputs.map((output) => normalizeOutputPayload(output, directory));
  if (outputs.some((output) => !output)) {
    throw new Error(`Unsafe output group journal ${journal}: all output paths must stay in ${path.resolve(directory)}.`);
  }
  if (allowedFinalPaths) {
    const allowedOutputs = outputs.filter((output) => allowedFinalPaths.has(recoveryPathKey(output.final)));
    if (allowedOutputs.length === 0) return null;
    if (allowedOutputs.length !== outputs.length) {
      throw new Error(`Unsafe output group journal ${journal}: partially overlaps planned outputs.`);
    }
  }
  if (allowedFinalPaths && !outputs.every(isManagedOutputPayload)) {
    return null;
  }
  if (allowedFinalPaths && !isRecoverableManagedJournal(payload, journal, {
    prefix: GROUP_JOURNAL_PREFIX,
    suffix: GROUP_JOURNAL_SUFFIX
  })) {
    return null;
  }
  return {
    journal,
    phase: String(payload.phase ?? "pending"),
    finalized: Boolean(payload.finalized),
    outputs
  };
}

async function writeJsonAtomically(filePath, payload) {
  const tempPath = `${filePath}.writing`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readJournalPayload(journal, label) {
  let text;
  try {
    text = await readFile(journal, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not read ${label} journal ${journal}: ${error.message}`);
  }
}

function normalizeOutputPayload(payload, directory) {
  const output = {
    final: path.resolve(String(payload.final ?? "")),
    temp: path.resolve(String(payload.temp ?? "")),
    backup: path.resolve(String(payload.backup ?? "")),
    journal: path.resolve(String(payload.journal ?? "")),
    token: String(payload.token ?? ""),
    hadExistingFinal: Boolean(payload.hadExistingFinal),
    phase: String(payload.phase ?? "started"),
    finalized: Boolean(payload.finalized)
  };
  const root = path.resolve(directory);
  if (![output.final, output.temp, output.backup, output.journal].every((candidate) => path.dirname(candidate) === root)) {
    return null;
  }
  if (!isTransactionJournalName(path.basename(output.journal))) return null;
  if (!hasExpectedAuxiliaryName(output.final, output.temp, ".tmp") || !hasExpectedAuxiliaryName(output.final, output.backup, ".bak")) {
    return null;
  }
  return output;
}

function hasExpectedAuxiliaryName(finalPath, auxiliaryPath, suffix) {
  const finalName = path.basename(finalPath);
  const auxiliaryName = path.basename(auxiliaryPath);
  const extension = path.extname(finalName);
  const stem = extension ? finalName.slice(0, -extension.length) : finalName;
  const legacyShape = auxiliaryName.startsWith(`.${finalName}.`) && auxiliaryName.endsWith(suffix);
  const mediaFriendlyShape = auxiliaryName.startsWith(`.${stem}.`) && auxiliaryName.endsWith(`${suffix}${extension}`);
  return legacyShape || mediaFriendlyShape;
}

function isRecoverableManagedJournal(payload, journal, { prefix, suffix, final, temp, backup }) {
  if (payload.owner !== JOURNAL_OWNER) return false;
  const token = extractJournalToken(journal, prefix, suffix);
  if (!token || payload.token !== token) return false;
  if (!isStaleJournalTimestamp(payload.updatedAt)) return false;
  if (final && temp && backup && !auxiliaryNamesContainToken(final, temp, backup, token)) return false;
  return true;
}

function isManagedOutputPayload(output) {
  const token = extractJournalToken(output.journal, JOURNAL_PREFIX, JOURNAL_SUFFIX);
  if (!token || output.token !== token) return false;
  return auxiliaryNamesContainToken(output.final, output.temp, output.backup, token);
}

function auxiliaryNamesContainToken(finalPath, tempPath, backupPath, token) {
  const finalName = path.basename(finalPath);
  return auxiliaryNameMatchesToken(finalName, path.basename(tempPath), token, ".tmp")
    && auxiliaryNameMatchesToken(finalName, path.basename(backupPath), token, ".bak");
}

function auxiliaryNameMatchesToken(finalName, auxiliaryName, token, suffix) {
  const extension = path.extname(finalName);
  const stem = extension ? finalName.slice(0, -extension.length) : finalName;
  return auxiliaryName === `.${finalName}.${token}${suffix}`
    || auxiliaryName === `.${stem}.${token}${suffix}${extension}`;
}

function isStaleJournalTimestamp(value) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp >= MANAGED_JOURNAL_STALE_MS;
}

function extractJournalToken(journal, prefix, suffix) {
  const name = path.basename(String(journal ?? ""));
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return "";
  return name.slice(prefix.length, -suffix.length);
}

function isTransactionJournalName(name) {
  return name.startsWith(JOURNAL_PREFIX) && name.endsWith(JOURNAL_SUFFIX);
}

function isOutputGroupJournalName(name) {
  return name.startsWith(GROUP_JOURNAL_PREFIX) && name.endsWith(GROUP_JOURNAL_SUFFIX);
}

function assertSingleOutputDirectory(outputs) {
  const directories = new Set(outputs.map((output) => path.dirname(path.resolve(output.final))));
  if (directories.size !== 1) {
    throw new Error("Output group transactions require all outputs to share one directory.");
  }
  return directories.values().next().value;
}

function snapshotOutput(output) {
  return {
    final: output.final,
    temp: output.temp,
    backup: output.backup,
    journal: output.journal,
    token: output.token ?? extractJournalToken(output.journal, JOURNAL_PREFIX, JOURNAL_SUFFIX),
    hadExistingFinal: Boolean(output.hadExistingFinal),
    phase: output.phase,
    finalized: Boolean(output.finalized)
  };
}

function recoveryPathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function removeTransactionJournal(journal) {
  if (!journal) return;
  try {
    await rm(journal, { force: true });
  } catch (error) {
    if (error.code === "EISDIR" || error.code === "ERR_FS_EISDIR") return;
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function isSameFile(left, right) {
  try {
    const [leftInfo, rightInfo] = await Promise.all([stat(left), stat(right)]);
    return leftInfo.dev === rightInfo.dev && leftInfo.ino === rightInfo.ino;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
