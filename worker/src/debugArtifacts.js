// Object storage backend (R2 / Render disk / S3-compatible) isn't chosen yet —
// see architecture.md §9 open items. Until then, just log so failures stay visible
// instead of silently dropping context.
async function captureDebugArtifacts({ runId, error }) {
  console.error(`[worker] run ${runId} failed, artifact capture not wired up yet:`, error.message);
}

module.exports = { captureDebugArtifacts };
