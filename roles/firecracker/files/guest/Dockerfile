ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

# Avoid interactive prompts during package install
ENV DEBIAN_FRONTEND=noninteractive

# Install openssh-server if not already present
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      openssh-server \
      iproute2 \
      locales && \
    rm -rf /var/lib/apt/lists/*

# Generate locale
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# SSH setup: host keys, privilege separation, root login via pubkey only
RUN ssh-keygen -A && \
    mkdir -p /run/sshd /var/empty/sshd && \
    id sshd &>/dev/null || useradd -r -s /bin/false -d /var/empty/sshd sshd && \
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && \
    sed -i 's/^#*PermitEmptyPasswords.*/PermitEmptyPasswords no/' /etc/ssh/sshd_config

# Unlock root account (pubkey-only, no password)
RUN passwd -d root

# DNS
RUN echo "nameserver 1.1.1.1" > /etc/resolv.conf

# Guest scripts
COPY vsock-ssh-relay /usr/local/bin/vsock-ssh-relay
COPY fc-init /sbin/fc-init
RUN chmod 755 /usr/local/bin/vsock-ssh-relay /sbin/fc-init

# SSH authorized key gets baked in at build time via --build-arg
ARG SSH_PUBKEY=""
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh && \
    if [ -n "$SSH_PUBKEY" ]; then \
      echo "$SSH_PUBKEY" > /root/.ssh/authorized_keys && \
      chmod 600 /root/.ssh/authorized_keys; \
    fi
