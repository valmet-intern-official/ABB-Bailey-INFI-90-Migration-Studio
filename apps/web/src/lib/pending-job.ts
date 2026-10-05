/**
 * Hands the files picked on the landing page to /studio/processing.
 * Lives in client memory only: a hard refresh on the processing page has no job and returns to the studio.
 */
export type PendingJob = { kind: "cad"; file: File } | { kind: "m1"; files: File[] };

let pending: PendingJob | null = null;

export function setPendingJob(job: PendingJob) {
  pending = job;
}

export function getPendingJob(): PendingJob | null {
  return pending;
}

export function clearPendingJob() {
  pending = null;
}
