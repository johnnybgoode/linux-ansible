# Provision Runbook

## Part 1 — On the target machine (direct console)

### 1.1 Install Ubuntu Server 24.04 LTS

- Boot from USB, select **Ubuntu Server** (GA kernel, not HWE — better for older hardware).
- In the storage screen, select **Use entire disk** with LVM. Edit the default logical volume to use 100% of the volume group (the installer defaults to ~50%).
- Create your user account. Skip Ubuntu Pro — you can enable it later if needed.
- Enable the OpenSSH server when prompted.
- Finish install and reboot.

### 1.2 Clone and configure

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/johnnybgoode/provision.git ~/provision
cd ~/provision
```

### 1.3 Create the vault

Generate a [Tailscale auth key](https://login.tailscale.com/admin/settings/keys) (reusable, ephemeral off), then:

```bash
sudo apt-get install -y ansible-core
ansible-vault create group_vars/vault.yml
```

Add the following content when the editor opens:

```yaml
vault_tailscale_authkey: "tskey-auth-..."
```

### 1.4 Run the playbook

```bash
chmod +x bootstrap.sh
./bootstrap.sh
```

You'll be prompted for:
- **Vault password** — the password you set when creating the vault
- **BECOME password** — your sudo password

### 1.5 Verify

```bash
# Log out and back in for shell changes (zsh)
logout

# After logging back in:
tailscale status          # should show this machine on the tailnet
nvim --version            # should be v0.11.6
node --version            # should be Node LTS
claude --version          # Claude Code
```

---

## Part 2 — From your laptop (remote setup)

### 2.1 Install Tailscale

If you haven't already: [tailscale.com/download](https://tailscale.com/download)

Make sure both machines are on the same tailnet:

```bash
tailscale status
```

### 2.2 Install the Ghostty terminfo (if using Ghostty)

Ghostty sets `TERM=xterm-ghostty` which remote servers don't recognise. Fix it once:

```bash
infocmp -x xterm-ghostty | ssh <hostname> tic -x -
```

Skip this if you use Terminal.app, iTerm2, or another terminal.

### 2.3 Connect

```bash
ssh <hostname>
```

Tailscale SSH handles authentication — no keys or passwords needed. MagicDNS resolves the hostname automatically.

### 2.4 Optional: SSH config

Add to `~/.ssh/config` on your laptop for convenience:

```
Host <hostname>
    User <your-username>
    # If MagicDNS is unreliable, uncomment and set the Tailscale IP:
    # HostName 100.x.y.z
```

### 2.5 tmux workflow

```bash
ssh <hostname>
tmux new -s work          # first session
tmux a -t work            # reconnect after disconnect
```

Sessions survive network drops — close your laptop and pick up where you left off.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `sudo: a password is required` during playbook | Expected — enter your sudo password at the BECOME prompt |
| `Missing privilege separation directory: /run/sshd` | Should be handled by the ssh role; if not, run `sudo mkdir -p /run/sshd` |
| Can't resolve hostname over SSH | Run `tailscale status` on both machines; use the Tailscale IP directly |
| Delete key sends space (Ghostty) | Install the terminfo — see §2.2 |
| nvim too old / LazyVim errors | The neovim role installs from GitHub releases; re-run the playbook |
| Vault password wrong | `ansible-vault rekey group_vars/vault.yml` to change it |

## Re-running the playbook

The playbook is idempotent. To re-run after changes:

```bash
cd ~/provision
git pull
ansible-playbook provision.yml --ask-vault-pass --ask-become-pass
```
