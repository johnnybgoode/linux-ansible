# Sprites Ansible Provisioning — Project Structure

```
sprites-ansible/
├── inventory/
│   ├── hosts.yml                  # all sprite instances
│   └── host_vars/
│       └── dohed-sprite/
│           ├── vars.yml           # non-secret host vars
│           └── vault.yml          # encrypted secrets (git-safe)
├── roles/
│   ├── base/
│   │   └── tasks/
│   │       └── main.yml           # installs Tailscale
│   └── project_secrets/
│       └── tasks/
│           └── main.yml           # writes ~/.env from vault vars
├── base.yml                       # playbook: run base role only
├── secrets.yml                    # playbook: run secrets role only
├── site.yml                       # playbook: run both (full provision)
└── .vault_pass                    # local only, never committed
```

## Usage

Full provision (new sprite):
```bash
ansible-playbook site.yml -i inventory/hosts.yml --vault-password-file .vault_pass -l dohed-sprite
```

Secrets only (rotate a token):
```bash
ansible-playbook secrets.yml -i inventory/hosts.yml --vault-password-file .vault_pass -l dohed-sprite
```

Base only (add tailscale to a new sprite before secrets are ready):
```bash
ansible-playbook base.yml -i inventory/hosts.yml -l dohed-sprite
```

## Vault password

Store `.vault_pass` locally only. Add it to `.gitignore`:
```
.vault_pass
```

To create/edit a vault file:
```bash
ansible-vault edit inventory/host_vars/dohed-sprite/vault.yml --vault-password-file .vault_pass
```


inventory/
├── group_vars/
│   └── all/
│       └── vault.yml          # vault_tailscale_auth_key lives here
└── host_vars/
    └── engram-sprite/
        └── vault.yml          # sprite-specific API keys live here
