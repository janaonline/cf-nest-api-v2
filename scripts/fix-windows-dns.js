// Workaround for a Node/c-ares bug on Windows: when a VPN adapter is active
// alongside the primary network adapter, c-ares can fail to enumerate a
// valid DNS server and silently falls back to 127.0.0.1, which breaks
// mongodb+srv:// SRV/TXT lookups with ECONNREFUSED. Only patches DNS servers
// when that specific broken state is detected, so it's a no-op everywhere
// else (other OSes, machines without the bug, CI, production).
if (process.platform === 'win32') {
  const dns = require('dns');
  const servers = dns.getServers();
  if (servers.length === 1 && servers[0] === '127.0.0.1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
}
