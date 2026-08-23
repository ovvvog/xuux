import { randomUUID } from 'node:crypto';
export const Classification=Object.freeze({PUBLIC:'public',INTERNAL:'internal',SENSITIVE:'sensitive',SOVEREIGN:'sovereign'});
export class DataCatalog {
  constructor({log}={}){if(!log)throw new Error('DATA_CATALOG_DEPENDENCY_MISSING');this.log=log;this.records=new Map();}
  register({name,owner,classification=Classification.INTERNAL,source,lineage=[],retentionDays=0}){if(!name||!owner||!source)throw new Error('DATA_CONTRACT_REQUIRED');if(!Object.values(Classification).includes(classification))throw new Error('INVALID_CLASSIFICATION');const id='data:'+randomUUID();const r={id,name,owner,classification,source,lineage:[...lineage],retentionDays,quality:'unverified',createdAt:new Date().toISOString()};this.records.set(id,r);this.log.append('data.registered',owner,{id,name,classification});return Object.freeze({...r});}
  markQuality(id,quality){const r=this.records.get(id);if(!r)throw new Error('DATASET_NOT_FOUND');if(!['verified','degraded','rejected'].includes(quality))throw new Error('INVALID_QUALITY');r.quality=quality;this.log.append('data.quality.changed',r.owner,{id,quality});return Object.freeze({...r});}
  canRead(id,actor,clearance){const r=this.records.get(id);if(!r)throw new Error('DATASET_NOT_FOUND');const rank={public:0,internal:1,sensitive:2,sovereign:3};if((rank[clearance]??-1)<rank[r.classification])throw new Error('DATA_ACCESS_DENIED');this.log.append('data.read.authorized',actor,{id});return true;}
  get(id){const r=this.records.get(id);return r?Object.freeze({...r}):null;}
}
