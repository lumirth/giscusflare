/** Cloudflare constructs the established repository coordinator from its durable binding. */
export interface Registration {repositoryId:string;installationId:number;categoryId:string}
export declare class Repository {
  constructor(state:unknown,env:unknown);
  execute(operation:string,input:unknown,registration:Registration,authority?:{session?:string;browserCookie?:string}):Promise<unknown>;
  alarm():Promise<void>;
}
declare const service:{fetch(request:Request,env:unknown,context?:unknown):Response|Promise<Response>};
export default service;
