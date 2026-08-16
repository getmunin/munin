export type DrainOutcome = 'empty' | 'suppressed' | 'claim_failed' | 'provider_unhealthy' | 'paused';

export interface DrainOptions<Job> {
  admit: () => Promise<boolean>;
  claim: () => Promise<Job[]>;
  execute: (job: Job) => Promise<boolean>;
  maxJobs: number;
  isStopped: () => boolean;
  onClaimError: (err: unknown) => void;
}

export async function drainCuratorQueue<Job>(opts: DrainOptions<Job>): Promise<DrainOutcome> {
  let drained = 0;
  while (!opts.isStopped()) {
    if (!(await opts.admit())) return 'suppressed';

    let jobs: Job[];
    try {
      jobs = await opts.claim();
    } catch (err) {
      opts.onClaimError(err);
      return 'claim_failed';
    }
    if (jobs.length === 0) return 'empty';

    for (const job of jobs) {
      if (opts.isStopped()) return 'empty';
      const providerFailed = await opts.execute(job);
      if (providerFailed) return 'provider_unhealthy';
      drained += 1;
    }

    if (drained >= opts.maxJobs) return 'paused';
  }
  return 'empty';
}
