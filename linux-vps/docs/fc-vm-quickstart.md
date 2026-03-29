# Quickstart `fc-vm`

## Rebuild rootfs (SSH key + vsock relay get baked in)
sudo rm /opt/firecracker/images/rootfs.ext4
fc-vm build --config my-vm.json --image ubuntu:24.04 --size 1024

## Start (now assigns vsock CID automatically)
fc-vm start --config my-vm.json --name project-a

## SSH in over vsock — no network config needed
fc-vm connect --name project-a

## File operations from host (once vsock relay is running in guest)
scp -o "ProxyCommand=fc-vsock-ssh /opt/firecracker/vms/project-a/v.sock 22" \
    -i /opt/firecracker/ssh/fc_vm_key ./myfile root@localhost:/root/

## FUSE mount for live bidirectional access
sshfs -o "ProxyCommand=fc-vsock-ssh /opt/firecracker/vms/project-a/v.sock 22" \
      -o IdentityFile=/opt/firecracker/ssh/fc_vm_key \
      root@localhost:/workspace ~/mnt/project-a

fc-vm status   # shows CID per VM
fc-vm stop --name project-a
