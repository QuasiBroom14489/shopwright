import type { AnyEvent, Run, Stage } from '@shopwright/shared';

interface RunRow {
  id: string;
  shopId: string | null;
  lineId: string | null;
  stage: Stage;
}

/** A run's state, folded from its events. There is no status column. */
export function foldRun(row: RunRow, events: AnyEvent[]): Run {
  const run: Run = {
    ...row,
    status: 'running',
    startedAt: 0,
    endedAt: null,
    inputs: {},
    configVersion: '',
    basedOn: null,
    summary: null,
    error: null,
    artifacts: [],
    costUsd: 0,
  };
  for (const ev of events) {
    switch (ev.kind) {
      case 'run.started':
        run.startedAt = ev.ts;
        run.inputs = ev.payload.inputs;
        run.configVersion = ev.payload.configVersion;
        run.basedOn = ev.payload.basedOn ?? null;
        break;
      case 'run.completed':
        run.status = 'completed';
        run.endedAt = ev.ts;
        run.summary = ev.payload.summary;
        run.artifacts = ev.payload.artifacts;
        break;
      case 'run.failed':
        run.status = 'failed';
        run.endedAt = ev.ts;
        run.error = ev.payload.error;
        break;
      case 'llm.called':
        run.costUsd += ev.payload.costUsd;
        break;
    }
  }
  return run;
}
