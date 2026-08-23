import { randomUUID } from 'node:crypto';
export class AgentMemoryStore {
  constructor({catalog,log,maxEntries=100000}={}){if(!catalog||!log)throw new Error('MEMORY_DEPENDENCY_MISSING');this.catalog=catalog;this.log=log;this.maxEntries=maxEntries;this.entries=new Map();}
  remember(agentId,content,{classification='internal',source='agent'}={}){if(this.entries.size>=this.maxEntries)throw new Error('MEMORY_QUOTA_EXCEEDED');const dataset=this.catalog.register({name:`memory:${agentId}`,owner:agentId,classification,source,retentionDays:30});const id='memory:'+randomUUID();const e={id,agentId,datasetId:dataset.id,content,createdAt:new Date().toISOString()};this.entries.set(id,e);this.log.append('memory.created',agentId,{id,datasetId:dataset.id});return Object.freeze({...e});}
  recall(agentId,id,clearance='internal'){const e=this.entries.get(id);if(!e||e.agentId!==agentId)throw new Error('MEMORY_NOT_FOUND');this.catalog.canRead(e.datasetId,agentId,clearance);return Object.freeze({...e});}
  forget(agentId,id){const e=this.entries.get(id);if(!e||e.agentId!==agentId)throw new Error('MEMORY_NOT_FOUND');this.entries.delete(id);this.log.append('memory.deleted',agentId,{id});return true;}
}
