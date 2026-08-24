// Loads a machine's non-secret configuration from machines/<ID>/machine.config.json.
// Secrets (the Cubo API key) are never in this file — see MACHINE-CONFIG.md.

export async function loadMachineConfig(machineId, { baseUrl = '../machines' } = {}) {
  const res = await fetch(`${baseUrl}/${machineId}/machine.config.json`);
  if (!res.ok) {
    throw new Error(`No machine config found for "${machineId}" (HTTP ${res.status})`);
  }
  const config = await res.json();
  if (config.enabled === false) {
    throw new Error(
      `Machine "${machineId}" has a config template but is not enabled yet. Fill in machines/${machineId}/machine.config.json and set "enabled": true.`
    );
  }
  return config;
}
