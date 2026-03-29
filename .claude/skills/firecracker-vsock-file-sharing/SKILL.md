---
name: firecracker-vsock-file-sharing
description: Use when setting up file sharing between a Linux host and Firecracker microVM guests over vsock, configuring SSH/SFTP/rsync/sshfs over vsock, or troubleshooting vsock connectivity with Firecracker. Triggers on keywords like vsock, Firecracker file share, socat relay, guest host file transfer, sshfs microVM.
---

# Firecracker vsock File Sharing

Set up bidirectional file sharing between a Linux host and Firecracker microVM guests using SSH/SFTP over vsock. No guest network interface required.

## Overview

Firecracker has no virtio-fs or 9p support (deliberately rejected for security). vsock is the only non-block-device channel between host and guest. This skill implements the SSH/SFTP-over-vsock approach — the most capable off-the-shelf solution, enabling scp, sftp, rsync, and sshfs FUSE mounts.

**Core constraint**: Firecracker's host side uses AF_UNIX sockets with a text CONNECT handshake, NOT native AF_VSOCK. All QEMU-style `VSOCK-CONNECT` examples fail on the host side. The guest side is standard AF_VSOCK.

## When to Use

- Setting up file sharing with Firecracker microVMs
- Need live, bidirectional file access (not just static block devices)
- Want directory sync (rsync) or FUSE-mounted shared directories (sshfs)
- No guest network interface available or desired
- Building a dev/test environment around Firecracker

**When NOT to use:**
- Pre-staging immutable data at boot time — use DriveMount/block devices instead (near-native I/O)
- Need maximum throughput for large files (>1 GB) — consider a custom raw vsock streaming tool (see Raw vsock Alternative below)
- Using QEMU instead of Firecracker — standard `VSOCK-CONNECT` socat commands work directly

## Prerequisites

### Host
- Firecracker binary installed and functional
- Kernel config: `CONFIG_VHOST_VSOCK=m`
- `socat` >= 1.7.4 **OR** `systemd` >= 256 (for systemd-ssh-proxy)

### Guest rootfs
- `sshd` installed and enabled (OpenSSH)
- `socat` installed
- SSH public key in `/root/.ssh/authorized_keys` (or appropriate user)
- Kernel config: `CONFIG_VIRTIO_VSOCKETS=y`
- Verify in guest: `ls /dev/vsock` should exist

## Implementation

### Step 1: Configure vsock device on the Firecracker VM

Add vsock to the VM configuration json:

```json
{
  "vsock": {
      "guest_cid": 3,
      "uds_path": "./v.sock"
  }
}
```

- `guest_cid`: unique integer per VM (avoid 0, 1, 2 — reserved)
- `uds_path`: host-side AF_UNIX socket path Firecracker will create

### Step 2: Start socat relay inside the guest

After the VM boots, run inside the guest:

```bash
socat VSOCK-LISTEN:22,reuseaddr,fork TCP:localhost:22
```

This bridges vsock port 22 to the local SSH daemon. Run as a systemd service for persistence:

```ini
# /etc/systemd/system/vsock-ssh-relay.service
[Unit]
Description=vsock to SSH relay
After=sshd.service

[Service]
ExecStart=/usr/bin/socat VSOCK-LISTEN:22,reuseaddr,fork TCP:localhost:22
Restart=always

[Install]
WantedBy=multi-user.target
```

### Step 3: Connect from the host

**Option A — systemd-ssh-proxy (preferred, systemd >= 256):**

SSH config is typically auto-installed at `/etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf`:

```
Host vsock-mux/*
    ProxyCommand /usr/lib/systemd/systemd-ssh-proxy %h %p
    ProxyUseFdpass yes
```

Connect using the UDS path:

```bash
ssh vsock-mux/path/to/v.sock
```

**Option B — manual socat ProxyCommand:**

```bash
# Write a small helper script: fc-vsock-ssh.sh
#!/bin/bash
UDS_PATH="$1"
PORT="${2:-22}"
exec socat - UNIX-CONNECT:"$UDS_PATH" <<< "CONNECT $PORT"
```

```bash
chmod +x fc-vsock-ssh.sh
ssh -o "ProxyCommand ./fc-vsock-ssh.sh ./v.sock 22" root@localhost
```

**Option C — SSH config for convenience:**

```
Host fc-vm-*
    ProxyCommand /path/to/fc-vsock-ssh.sh /path/to/%h.sock 22
    User root
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    IdentityFile ~/.ssh/firecracker_vm_key
    ServerAliveInterval 5
    ServerAliveCountMax 3
```

Then just: `ssh fc-vm-myvm`

### Step 4: File operations

Once SSH works, all SSH-based file tools work:

```bash
# Single file copy
scp -o "ProxyCommand ..." localfile root@vm:/remote/path

# Recursive copy
scp -r -o "ProxyCommand ..." ./mydir root@vm:/opt/

# Directory sync (incremental, preserves permissions)
rsync -avz -e "ssh -o 'ProxyCommand ...'" ./src/ root@vm:/dest/

# FUSE mount — live bidirectional shared directory
sshfs -o "ProxyCommand=..." root@vm:/guest/path /local/mount

# Unmount
fusermount -u /local/mount
```

With ssh_config set up (Option C), these simplify to:

```bash
scp localfile fc-vm-myvm:/remote/path
rsync -avz -e "ssh" ./src/ fc-vm-myvm:/dest/
sshfs fc-vm-myvm:/guest/path /local/mount
```

## Quick Reference

| Operation | Command |
|-----------|---------|
| Configure vsock | `PUT /vsock` with `guest_cid` + `uds_path` |
| Guest relay | `socat VSOCK-LISTEN:22,reuseaddr,fork TCP:localhost:22` |
| SSH connect | `ssh vsock-mux/<uds_path>` |
| Copy file in | `scp <file> fc-vm-<name>:/path` |
| Copy file out | `scp fc-vm-<name>:/path <local>` |
| Sync directory | `rsync -avz ./src/ fc-vm-<name>:/dest/` |
| Mount directory | `sshfs fc-vm-<name>:/path /mnt` |
| Unmount | `fusermount -u /mnt` |

## Multi-VM Setup

Each VM needs a unique `guest_cid` and `uds_path`:

```bash
# VM 1
curl ... -d '{"guest_cid": 3, "uds_path": "./vm1.sock"}'
# VM 2
curl ... -d '{"guest_cid": 4, "uds_path": "./vm2.sock"}'
```

For snapshot/restore, use `vsock_override` to remap paths:

```json
{
  "snapshot_path": "./snapshot_file",
  "mem_backend": {"backend_path": "./mem_file"},
  "vsock_override": {"uds_path": "./vm1-clone.sock"}
}
```

## Snapshot/Restore Caveats

**All SSH connections break on snapshot.** Additionally:

- **Silent stall bug**: socat processes blocked in `read()` before snapshot are NOT interrupted on restore. They stall silently — only new I/O discovers the broken state.
- **Mitigation**: always set `ServerAliveInterval 5` and `ServerAliveCountMax 3` in SSH config to detect dead connections within ~15 seconds.
- **sshfs**: if the underlying SSH connection dies, `fusermount -uz /mnt` (lazy unmount) is required.
- **Design pattern**: prefer short-lived SSH sessions (scp/rsync per operation) over long-lived mounts if snapshot/restore is frequent.

## Performance

| Metric | Value |
|--------|-------|
| Raw vsock throughput | ~3.6-10 Gbps |
| Two-socat-relay chain | ~1.5 Gbps (~8.6x degradation) |
| SSH + socat chain | Lower still (cipher overhead) |
| vsock is host-local | Not routable — encryption is optional |

**To skip encryption** (where security posture allows): expose `sftp-server` directly on a vsock port inside the guest and connect sshfs to it, bypassing the SSH handshake and cipher.

```bash
# Guest: expose sftp-server directly on vsock port 2222
socat VSOCK-LISTEN:2222,reuseaddr,fork EXEC:"/usr/lib/openssh/sftp-server"
```

## Raw vsock Alternative

For maximum throughput on large files, a custom raw vsock tool avoids all SSH and socat overhead. This requires building a small Go binary using `firecracker-go-sdk/vsock`:

```go
// Host side — Firecracker-aware dial
import fcsdk "github.com/firecracker-microvm/firecracker-go-sdk/vsock"

conn, err := fcsdk.DialContext(ctx, "/path/to/v.sock", 9000)
io.Copy(conn, srcFile)  // stream file to guest

// Guest side — standard AF_VSOCK via mdlayher/vsock
import "github.com/mdlayher/vsock"

l, _ := vsock.Listen(9000, nil)
conn, _ := l.Accept()
io.Copy(destFile, conn)  // receive file from host
```

**Trade-off**: ~2-3x faster than SSH/socat for large files, but you lose multi-file, directory sync, permissions, and authentication. Use only for specific bulk-transfer bottlenecks.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `VSOCK-CONNECT:<CID>:<port>` on the host | Firecracker uses AF_UNIX, not AF_VSOCK on host. Use `UNIX-CONNECT:<uds_path>` + CONNECT handshake |
| Forgetting the CONNECT handshake | Host must send `"CONNECT <port>\n"` and read `"OK ...\n"` before data flows |
| Using CID 0, 1, or 2 for guest_cid | Reserved values. CID 2 = host. Start guest CIDs at 3 |
| No `ServerAliveInterval` in SSH config | SSH won't detect dead vsock connections after snapshot/restore |
| sshfs mount hangs after snapshot | Use `fusermount -uz` (lazy unmount), then remount |
| Same `uds_path` for multiple VMs | Each VM needs a unique socket path. Use `vsock_override` on restore |
| Guest missing `/dev/vsock` | Guest kernel needs `CONFIG_VIRTIO_VSOCKETS=y` compiled in |
| socat too old | Need socat >= 1.7.4 for `VSOCK-LISTEN`/`VSOCK-CONNECT` address types |
