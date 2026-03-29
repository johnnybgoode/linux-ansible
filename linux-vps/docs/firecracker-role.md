# Firecracker Role — Implementation Details

## Overview

The `firecracker` Ansible role prepares a host to build and run Firecracker microVMs. It installs the Firecracker VMM, configures KVM, sets up NAT networking, and provides the `fc-vm` CLI for managing VM lifecycle. VMs connect to the host over vsock for SSH access — no shared network required.

The target use case is running AI coding agents (Claude Code, Codex) in isolated, persistent microVM environments.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Host (Ubuntu 24.04)                                             │
│                                                                 │
│  fc-vm CLI                                                      │
│    ├── build:   docker build → export → ext4 rootfs             │
│    ├── start:   tap setup → drive copy → firecracker launch     │
│    ├── connect: SSH over vsock (fc-vsock-ssh ProxyCommand)      │
│    ├── stop:    API shutdown → tap teardown                     │
│    └── status:  list VMs with PID, CID, tap devices             │
│                                                                 │
│  /dev/kvm (kvm + kvm_amd/kvm_intel)                             │
│  /dev/vhost-vsock (vhost_vsock module)                          │
│                                                                 │
│  172.16.0.0/24 ─── nftables masquerade ─── internet             │
│       │                                                         │
│    tap device (fc-<name>)                                       │
│       │                                                         │
│  ┌────┴──────────────────────────────────────┐                  │
│  │ Firecracker microVM                       │                  │
│  │                                           │                  │
│  │  fc-init (PID 1)                          │                  │
│  │    ├── mounts /proc, /sys, /dev/pts, /run │                  │
│  │    ├── starts sshd                        │                  │
│  │    ├── starts vsock-ssh-relay             │                  │
│  │    └── exec getty on ttyS0                │                  │
│  │                                           │                  │
│  │  eth0: 172.16.0.x (kernel cmdline IP)     │                  │
│  │  vsock: CID N, port 22 → sshd            │                  │
│  └───────────────────────────────────────────┘                  │
│       │                                                         │
│  v.sock (AF_UNIX) ← CONNECT handshake → fc-vsock-ssh → SSH     │
└─────────────────────────────────────────────────────────────────┘
```

## What Firecracker Is (and Isn't)

Firecracker is a lightweight VMM (Virtual Machine Monitor) built by AWS for Lambda and Fargate. It replaces QEMU entirely — no qemu packages are needed. Each VM is a real virtual machine with its own kernel, not a container.

Key constraints:
- **No virtio-fs or 9p** — can't mount host directories directly into the guest
- **No qcow2 or overlay filesystems** — drives are raw block devices (ext4 images)
- **No GPU passthrough** — CPU and memory only
- **Guest kernel must be uncompressed ELF** (`vmlinux`, not `bzImage`)

## Ansible Role: What Gets Installed

### Binaries (`/usr/local/bin/`)

| File | Purpose |
|------|---------|
| `firecracker` | The VMM itself (v1.15.0, static musl binary) |
| `jailer` | Production security wrapper (chroot, namespaces, privilege drop) |
| `fc-vm` | VM lifecycle CLI (build/start/stop/connect/status) |
| `fc-tap-setup` | Creates/destroys tap devices with IP assignment |
| `fc-vsock-ssh` | SSH ProxyCommand for vsock connections |

### Directory Structure (`/opt/firecracker/`)

```
/opt/firecracker/
├── kernel/vmlinux          # Guest kernel (downloaded on first build)
├── images/                 # Template rootfs images (built by fc-vm build)
├── vms/<name>/             # Per-instance runtime state
│   ├── config.json         # Runtime config (copied + patched from template)
│   ├── rootfs.ext4         # Instance's own rootfs copy
│   ├── firecracker.socket  # API socket (while running)
│   ├── firecracker.pid     # PID file (while running)
│   ├── v.sock              # vsock AF_UNIX socket (while running)
│   ├── cid                 # Assigned vsock CID (persistent)
│   └── tap_devices         # Active tap device names (while running)
├── guest/                  # Dockerfile + guest scripts
│   ├── Dockerfile
│   ├── fc-init
│   └── vsock-ssh-relay
├── ssh/                    # Keypair for VM access
│   ├── fc_vm_key
│   └── fc_vm_key.pub
├── next_cid                # Auto-incrementing CID counter (starts at 3)
└── example-vm.json         # Template VM config
```

### Kernel Modules

- `kvm` — base KVM module
- `kvm_intel` or `kvm_amd` — CPU-specific KVM (auto-detected via `ansible_processor`)
- `vhost_vsock` — host-side vsock support

**BIOS requirement**: hardware virtualization must be enabled (Intel VT-x or AMD SVM).

### Networking

- **IPv4 forwarding** enabled via sysctl
- **nftables** masquerade rule for `172.16.0.0/24` (persisted via `/etc/nftables-firecracker.conf`)
- **UFW** allows routed traffic from the microVM subnet
- Each VM gets a **tap device** with a `/30` subnet derived from the guest MAC address
- Guest IP is configured via kernel `boot_args` (`ip=` parameter), not DHCP

### Host Packages

`iproute2`, `socat`, `sshfs` — installed by the role for tap management and vsock file operations.

## VM Configuration

VMs are defined by Firecracker's native JSON config format. The user creates and edits config files directly — `fc-vm` doesn't abstract over the config, it just manages lifecycle around it.

### Key Config Sections

```json
{
  "boot-source": {
    "kernel_image_path": "/opt/firecracker/kernel/vmlinux",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off ip=<guest>::<gateway>:<mask>::eth0:off"
  },
  "drives": [
    { "drive_id": "rootfs", "path_on_host": "...", "is_root_device": true, "is_read_only": false }
  ],
  "network-interfaces": [
    { "iface_id": "eth0", "host_dev_name": "fc-example", "guest_mac": "AA:FC:00:00:00:01" }
  ],
  "machine-config": { "vcpu_count": 2, "mem_size_mib": 256 },
  "vsock": { "guest_cid": 3, "uds_path": "..." }
}
```

Additional drives are just more entries in the `drives` array — the guest sees them as `/dev/vdb`, `/dev/vdc`, etc. The full config schema is documented in the Firecracker OpenAPI spec (`firecracker.yaml` in the Firecracker repo).

### What `fc-vm start` Patches at Runtime

The template config is copied to `vms/<name>/config.json` on first start. `fc-vm` then patches:
1. **Drive paths** — rewritten to point to per-instance copies in `vms/<name>/`
2. **vsock** — injected with an auto-assigned CID and `uds_path` in the VM's directory
3. **boot_args** — appends `init=/sbin/fc-init` if no `init=` is present

## Guest Rootfs Build

`fc-vm build` uses Docker to construct the rootfs:

1. **`docker build`** with the user's base image (e.g. `docker/sandbox-templates:claude-code`) and the guest Dockerfile layered on top
2. **`docker export`** flattens the image to a tarball
3. Extract into an ext4 image file

### Guest Dockerfile Layers

The Dockerfile (`/opt/firecracker/guest/Dockerfile`) adds these layers on top of the base image:

- `openssh-server`, `iproute2`, `locales`
- SSH host key generation, sshd user, `PermitRootLogin prohibit-password`
- Root account unlocked (password-less, pubkey only)
- `en_US.UTF-8` locale
- `vsock-ssh-relay` script at `/usr/local/bin/`
- `fc-init` script at `/sbin/`
- Host SSH pubkey baked into `/root/.ssh/authorized_keys` via `--build-arg`

### Why Not systemd?

Docker-exported rootfs images don't have a working systemd — it needs cgroups, dbus, and other infrastructure that isn't present in the raw filesystem export. Instead, `fc-init` serves as PID 1:

1. Mounts `/proc`, `/sys`, `/dev/pts` (with correct PTY options), `/run`
2. Starts sshd
3. Starts the vsock-ssh-relay
4. Drops to `getty` on the serial console (for `--foreground` access)

The kernel is told to use `fc-init` via `init=/sbin/fc-init` in `boot_args`.

## vsock SSH Access

Firecracker's vsock implementation has a quirk: the **host side uses AF_UNIX sockets**, not AF_VSOCK. Connecting requires a text-based CONNECT handshake over the Unix domain socket.

### Connection Chain

```
fc-vm connect --name X
  └── ssh -o ProxyCommand="fc-vsock-ssh /opt/firecracker/vms/X/v.sock 22"
        └── fc-vsock-ssh (python3):
              1. Connect to AF_UNIX socket (v.sock)
              2. Send "CONNECT 22\n"
              3. Read "OK <port>\n"
              4. Bidirectional relay: stdin ↔ socket
                    └── Firecracker VMM bridges to guest AF_VSOCK
                          └── vsock-ssh-relay (python3, in guest):
                                Accepts AF_VSOCK connections on port 22
                                Proxies each to localhost:22 (sshd)
                                    └── sshd authenticates via pubkey
```

### Authentication

- **Ed25519 keypair** generated by the Ansible role at `/opt/firecracker/ssh/fc_vm_key`
- Public key baked into guest rootfs at build time
- `PermitRootLogin prohibit-password` — pubkey only, no password auth over SSH
- Root account is unlocked for serial console access (getty)

### CID Management

Each VM needs a unique vsock CID (Context ID). CIDs 0-2 are reserved (0=hypervisor, 1=reserved, 2=host).

- `/opt/firecracker/next_cid` stores the next available CID (starts at 3)
- On first start, a VM reads the counter, saves its CID to `vms/<name>/cid`, increments the counter
- Subsequent starts reuse the saved CID

## Instance Lifecycle

```
fc-vm build --config X.json --image ubuntu:24.04 --size 1024
  → Docker build + export → template rootfs at path specified in config

fc-vm start --config X.json --name project-a
  → First start: copies template rootfs to vms/project-a/rootfs.ext4
  → Patches runtime config (drive paths, vsock CID, init= boot arg)
  → Creates tap device, launches firecracker

fc-vm connect --name project-a
  → SSH over vsock (pubkey auth, no password)

fc-vm stop --name project-a
  → Graceful shutdown via Firecracker API (SendCtrlAltDel)
  → Falls back to SIGTERM after 5 seconds
  → Tears down tap device, cleans up socket files
  → Rootfs persists — state is preserved

fc-vm start --config X.json --name project-a
  → Reuses existing rootfs (all installed packages, files preserved)

fc-vm status
  → Lists all VMs: name, running/stopped, PID, CID, tap devices
```

### Instance Independence

Multiple instances from the same config template get independent filesystem copies:
```
fc-vm start --config web.json --name project-a   # copies rootfs
fc-vm start --config web.json --name project-b   # separate copy
```

To reset a VM to clean state: `rm -rf /opt/firecracker/vms/<name>` and start again.

## File Sharing (Work in Progress)

Firecracker has no virtio-fs/9p. Current options for host↔guest file transfer:

- **scp/rsync** over vsock — works now via `fc-vsock-ssh` ProxyCommand
- **sshfs** from host — mount guest directories on the host (works now)
- **Reverse SSH tunnel + sshfs** (planned) — mount host directories inside the guest via `-R` tunnel and sshfs from within the VM

## Hardware Notes

Tested on AMD Pro A12-8800B (Carrizo APU):
- Requires **SVM** enabled in BIOS (AMD's hardware virtualization)
- Uses `kvm_amd` module (auto-detected by Ansible)
- Guest kernel from Firecracker CI (6.1.x series)
- Host kernel 6.8 (Ubuntu 24.04 default) — works but not in Firecracker's official test matrix
