# Docker Toolkit for Unraid

Memory limits and IP address management for Docker containers on Unraid 7.

## Features

### Memory limit slider
- Adds a **Memory limit** slider to *Add Container* / *Edit Container* (below *Privileged*), in sensible steps from 256 MB up to the server's RAM, or *unlimited*.
- New containers get a configurable default limit (Settings › User Utilities › Docker Toolkit), so nothing starts unlimited by accident.
- The limit is stored as `--memory` / `--memory-swap` in *Extra Parameters*, so it is part of the normal Unraid template.

### IPAM (IP address management)
A new **IPAM** tab in the top navigation shows every macvlan/ipvlan Docker network:

- **Address map**: one tile per IP, colored by state (running, stopped, other device, gateway, reserved, duplicate, free). Click a tile to jump to its row.
- **Assignment table** with container icons, IP, MAC and status chips (fixed/dynamic IP, fixed/random MAC, duplicate IP).
- **Pin**: write a container's current IP and MAC into its template, no restart needed.
- **Change IP / Assign IP**: pick a free address; the template is updated (and gets a fixed MAC if it has none) and the container can be recreated right away. Containers sharing its network (`--network container:…`) are recreated too.
- **Leftover templates**: templates of removed or renamed containers are detected, hidden by default and do not count as used. They can be shown and **archived** (moved to `/boot/config/plugins/docker.toolkit/archived-templates`, restorable).
- **Other devices**: run a ping scan or add devices manually (firewall, printers, …) so their addresses are never suggested for containers. Devices can be pinned, moved or removed.
- **Reserved ranges** (e.g. a DHCP pool) and search by container, IP or MAC.
- **Lock current IPs/MACs**: one click gives every existing container its current IP and MAC as fixed values — useful before turning off DHCP on the firewall.

On *Add Container* the next free IP and a stable MAC address (locally administered, `02:…`, derived from network and container name) are suggested automatically, and IP conflicts are flagged while typing.

A backup of all user templates (`backups/templates-*.tgz`) is created before any template change.

## Installation

Unraid 7.0 or newer. In the web UI go to **Plugins › Install Plugin** and paste:

```
https://raw.githubusercontent.com/LX-S93/unraid-docker-toolkit/main/docker.toolkit.plg
```

Updates appear in **Plugins** like for any other plugin.

## Data

Everything is kept in `/boot/config/plugins/docker.toolkit/`:

| File | Content |
|------|---------|
| `settings.json` | default memory limit |
| `ipam.json` | devices and reserved ranges per network |
| `backups/` | template backups taken before changes |
| `archived-templates/` | archived leftover templates |

Removing the plugin keeps this folder.

## Building

```
./pkg_build.sh 2026.11.06
```

Packs `source/docker.toolkit` into `archive/docker.toolkit-<version>-x86_64-1.txz` and updates version and MD5 in `docker.toolkit.plg`. Add a changelog entry to the `.plg`, commit and push.

## License

MIT
