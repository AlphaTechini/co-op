// Lets the RPC banner retry every active poller at once.
type Retryable = { refresh(): Promise<void> };
const active = new Set<Retryable>();

export const register = (p: Retryable) => {
  active.add(p);
  return () => active.delete(p);
};

export const retryAll = () => {
  for (const p of active) void p.refresh();
};
