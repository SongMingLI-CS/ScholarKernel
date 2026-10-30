/** Suspension is control flow; it must not be converted to a failed node. */
export class JobSuspended extends Error {
  constructor() { super("JobWaitingForInput"); this.name = "JobSuspended" }
}
