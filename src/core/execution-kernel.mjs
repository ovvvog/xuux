import { randomUUID } from 'node:crypto';

export const TaskState = Object.freeze({ QUEUED:'queued', RUNNING:'running', SUCCEEDED:'succeeded', FAILED:'failed', STOPPED:'stopped' });

export class SafeMode {
  constructor() { this.active=false; this.reason=null; }
  enter(reason) { this.active=true; this.reason=reason; }
  leave() { this.active=false; this.reason=null; }
  assertOperational() { if (this.active) throw new Error(`SAFE_MODE: ${this.reason}`); }
}

export class ExecutionKernel {
  constructor({ crown, log, policy = null } = {}) {
    if (!crown || !log) throw new Error('KERNEL_DEPENDENCY_MISSING');
    this.crown=crown; this.log=log; this.policy=policy; this.safeMode=new SafeMode(); this.tasks=new Map();
  }
  submit(command, signature, handler) {
    this.safeMode.assertOperational();
    if (typeof handler !== 'function') throw new Error('TASK_HANDLER_REQUIRED');
    const accepted=this.crown.command(command,signature);
    const task={id:randomUUID(), command:accepted, state:TaskState.QUEUED, createdAt:new Date().toISOString()};
    this.tasks.set(task.id,task); this.log.append('kernel.task.queued',accepted.target,{taskId:task.id,action:accepted.action});
    try {
      task.state=TaskState.RUNNING; task.startedAt=new Date().toISOString(); this.log.append('kernel.task.started',accepted.target,{taskId:task.id});
      const result=handler(accepted); task.state=TaskState.SUCCEEDED; task.result=result; task.finishedAt=new Date().toISOString();
      this.log.append('kernel.task.succeeded',accepted.target,{taskId:task.id}); return Object.freeze({...task});
    } catch (error) {
      task.state=TaskState.FAILED; task.error=error instanceof Error ? error.message : String(error); task.finishedAt=new Date().toISOString();
      this.log.append('kernel.task.failed',accepted.target,{taskId:task.id,error:task.error}); throw error;
    }
  }
  stop(reason='kernel emergency stop') { this.safeMode.enter(reason); this.log.append('kernel.safe-mode.entered','crown',{reason}); }
  resume() { this.safeMode.leave(); this.log.append('kernel.safe-mode.left','crown',{}); }
  getTask(id) { const task=this.tasks.get(id); return task ? Object.freeze({...task}) : null; }
}
