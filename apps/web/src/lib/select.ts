/**
 * Model ids use '' for "the agent's own model", but a Select treats an empty value as nothing picked.
 * These map it to a sentinel on the way in and back to '' on the way out.
 */
const AGENT_DEFAULT = '__agent-default__'
export const toSelectValue = (id: string) => (id === '' ? AGENT_DEFAULT : id)
export const fromSelectValue = (value: string) => (value === AGENT_DEFAULT ? '' : value)
