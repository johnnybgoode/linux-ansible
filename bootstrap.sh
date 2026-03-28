#!/usr/bin/env bash
set -euo pipefail

# Run this script directly on the Ubuntu box as a sudo-capable user.
# It installs Ansible, then runs the playbook locally.
#
# Usage:
#   chmod +x bootstrap.sh
#   ./bootstrap.sh

echo "==> Installing Ansible..."
sudo apt-get update -qq
sudo apt-get install -y software-properties-common
sudo add-apt-repository -y ppa:ansible/ansible
sudo apt-get update -qq
sudo apt-get install -y ansible

echo "==> Running playbook..."
# You will be prompted for the vault password.
ansible-playbook provision.yml --ask-vault-pass --ask-become-pass

echo ""
echo "==> Done. Log out and back in for shell profile changes to take effect."
