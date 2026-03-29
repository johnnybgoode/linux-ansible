# [deprecated] Firecracker VM setup

Initial setup steps pre-creating the `fc-vm` tool

1. Get a guest kernel

  Firecracker needs an uncompressed vmlinux ELF binary (not bzImage). Easiest source is
  the Firecracker CI artifacts:

  curl -fsSL -o /opt/firecracker/vmlinux \
    https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/x86_64/kernels/vmlinux-6.1
  .102

  Or build your own from the guest kernel configs in the Firecracker repo's
  resources/guest_configs/.

  2. Build a rootfs

  Create a minimal ext4 filesystem image:

  dd if=/dev/zero of=/opt/firecracker/rootfs.ext4 bs=1M count=512
  mkfs.ext4 /opt/firecracker/rootfs.ext4

  # Populate it (e.g., from an Alpine or Ubuntu container)
  mkdir -p /tmp/rootfs-mnt
  sudo mount /opt/firecracker/rootfs.ext4 /tmp/rootfs-mnt
  sudo docker export $(docker create alpine:latest) | sudo tar -xf - -C /tmp/rootfs-mnt

  # Set up guest networking (static IP matching your tap config)
  # Add an init script or use kernel cmdline:
  ip=172.16.0.2::172.16.0.1:255.255.255.252::eth0:off
  sudo umount /tmp/rootfs-mnt

  3. Create a tap device

  sudo fc-tap-setup create tap0 172.16.0.1/30
  # Guest will be 172.16.0.2, gateway 172.16.0.1

  4. Start the VM

  firecracker --api-sock /tmp/firecracker.socket --config-file /dev/stdin <<'EOF'
  {
    "boot-source": {
      "kernel_image_path": "/opt/firecracker/vmlinux",
      "boot_args": "console=ttyS0 reboot=k panic=1 pci=off
  ip=172.16.0.2::172.16.0.1:255.255.255.252::eth0:off"
    },
    "drives": [{
      "drive_id": "rootfs",
      "path_on_host": "/opt/firecracker/rootfs.ext4",
      "is_root_device": true,
      "is_read_only": false
    }],
    "network-interfaces": [{
      "iface_id": "eth0",
      "guest_mac": "AA:FC:00:00:00:01",
      "host_dev_name": "tap0"
    }],
    "machine-config": {
      "vcpu_count": 2,
      "mem_size_mib": 256
    }
  }
  EOF

  5. Clean up when done

  # After VM exits
  sudo fc-tap-setup delete tap0
  rm /tmp/firecracker.socket

  For production, you'd use the jailer instead of calling firecracker directly — it wraps
  the VM in a chroot with namespace isolation and privilege dropping. But for getting
  started, the above works.
