type Result<T> = { value: T } | { error: unknown };
type Consumer<T> = { resolve(value:T):void; reject(error:unknown):void; release():void };
export interface BatchRequest<I,T> {
  input: I;
  dispatched: boolean;
  readonly active: boolean;
  wait(signal: AbortSignal): Promise<T>;
  finish(result: Result<T>): void;
}
/** Missing count facts and content bodies share acquisition, not interpretation or retention. */
export function batchRequests<I,T>(options: {
  run(inputs: I[], signal: AbortSignal): Promise<Result<T>[]>;
  group?(input: I): unknown;
  bytes?(input: I): number;
}) {
  type Job = BatchRequest<I,T> & { consumers:Set<Consumer<T>>; cohort?:{controller:AbortController;jobs:Job[]}; result?:Result<T> };
  const jobs = new Map<string,Job>(); let scheduled = false;
  const flush = () => {
    scheduled = false;
    const waiting = [...jobs.values()].filter(job => !job.dispatched);
    while (waiting.length) {
      const group = options.group?.(waiting[0]!.input), selected:Job[] = []; let bytes = 0;
      for (let index = 0; index < waiting.length && selected.length < 20;) {
        const job = waiting[index]!, size = options.bytes?.(job.input) || 0;
        if (options.group?.(job.input) !== group || selected.length && bytes + size > 3*1024*1024) { index++; continue; }
        selected.push(job); bytes += size; waiting.splice(index,1);
      }
      const cohort = {controller:new AbortController(),jobs:selected};
      for (const job of selected) {job.dispatched=true;job.cohort=cohort;}
      void Promise.resolve().then(()=>options.run(selected.map(job=>job.input),cohort.controller.signal)).then(results=> {
        if (results.length !== selected.length) throw new Error('Invalid batch response.');
        selected.forEach((job,index)=>job.finish(results[index]!));
      }).catch(error=>selected.forEach(job=>job.finish({error})));
    }
  };
  return (key:string,input:I):BatchRequest<I,T> => {
    const existing=jobs.get(key); if(existing)return existing;
    const job:Job = {input,dispatched:false,consumers:new Set(),get active(){return !job.result&&job.consumers.size>0;},
      finish(result) {
        if(job.result)return;
        job.result=result;if(jobs.get(key)===job)jobs.delete(key);
        for(const consumer of job.consumers) {consumer.release();if('error' in result)consumer.reject(result.error);else consumer.resolve(result.value);}
        job.consumers.clear();
      },
      wait(signal) {
        signal.throwIfAborted();
        if(job.result)return 'error' in job.result?Promise.reject(job.result.error):Promise.resolve(job.result.value);
        return new Promise<T>((resolve,reject)=> {
          const aborted=()=> {
            job.consumers.delete(consumer);reject(signal.reason);
            if(!job.consumers.size) {
              if(jobs.get(key)===job)jobs.delete(key);
              job.result={error:signal.reason};
              if(job.cohort&&!job.cohort.jobs.some(other=>other.consumers.size))job.cohort.controller.abort();
            }
          };
          const consumer={resolve,reject,release:()=>signal.removeEventListener('abort',aborted)};
          job.consumers.add(consumer);signal.addEventListener('abort',aborted,{once:true});
        });
      },
    };
    jobs.set(key,job);
    if(!scheduled){scheduled=true;queueMicrotask(flush);}
    return job;
  };
}
