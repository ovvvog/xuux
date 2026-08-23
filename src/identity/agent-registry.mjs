import { randomUUID } from 'node:crypto';

export const AgentState = Object.freeze({ ACTIVE:'active', SUSPENDED:'suspended', REVOKED:'revoked', RETIRED:'retired' });
const FORBIDDEN = new Set(['sovereign:root','key:export','policy:self-modify']);

export class AgentRegistry {
  constructor({ ca, log, maxAgents = 100000 } = {}) {
    if (!ca || !log) throw new Error('AGENT_REGISTRY_DEPENDENCY_MISSING');
    this.ca=ca; this.log=log; this.maxAgents=maxAgents; this.agents=new Map();
  }
  register({ name, role, capabilities = [], owner = 'crown' }) {
    if (!name || !role) throw new Error('AGENT_IDENTITY_REQUIRED');
    if (this.agents.size >= this.maxAgents) throw new Error('AGENT_QUOTA_EXCEEDED');
    if (capabilities.some(x => FORBIDDEN.has(x))) throw new Error('FORBIDDEN_CAPABILITY');
    const id='agent:'+randomUUID(); const certificate=this.ca.issue(id,role,capabilities);
    const record={id,name,role,owner,capabilities:[...capabilities],certificate,state:AgentState.ACTIVE,createdAt:new Date().toISOString()};
    this.agents.set(id,record); this.log.append('agent.registered',owner,{id,role,capabilities}); return Object.freeze({...record});
  }
  transition(id, state, reason) {
    const a=this.agents.get(id); if(!a) throw new Error('AGENT_NOT_FOUND');
    if(!Object.values(AgentState).includes(state)) throw new Error('INVALID_AGENT_STATE');
    if(a.state===AgentState.REVOKED && state!==AgentState.REVOKED) throw new Error('REVOKED_AGENT_IMMUTABLE');
    a.state=state; a.stateReason=reason; a.stateChangedAt=new Date().toISOString();
    if(state===AgentState.REVOKED) this.ca.revoke(a.certificate.id,reason||'agent revoked');
    this.log.append(`agent.${state}`, 'crown',{id,reason}); return Object.freeze({...a});
  }
  get(id) { const a=this.agents.get(id); return a ? Object.freeze({...a}) : null; }
  list(state) { return [...this.agents.values()].filter(x=>!state||x.state===state).map(x=>Object.freeze({...x})); }
}
