# Role `krunvm`

## System dependencies

```
sudo apt install -y \
  make gcc \
  python3-pyelftools \
  patchelf \
  asciidoctor \
  buildah \
  libssl-dev \
  libelf-dev \
  libclang-dev \
  llvm clang \
  clang lld \
  bc flex bison
```

## Rust/Cargo via `rustup` (apt version too old)

```
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

## `libkrunfw`

```
git clone https://github.com/containers/libkrunfw.git
cd libkrunfw
make
sudo make install
cd ..
```

## `libkrun`

```
bashgit clone https://github.com/containers/libkrun.git
cd libkrun
make
sudo make install
sudo ldconfig
cd ..
```

## Configure the dynamic linker for `/usr/local/lib64`

(do this before building `libkrun` so `ldconfig` is correct for subsequent steps)

```
echo '/usr/local/lib64' | sudo tee /etc/ld.so.conf.d/libkrun.conf
sudo ldconfig
```


## `krunvm`

```
git clone https://github.com/containers/krunvm.git
cd krunvm
LIBRARY_PATH=/usr/local/lib64 make
sudo make install
cd ..
```

## `KVM` group membership (if not already set)

`bashsudo usermod -aG kvm $USER`

 A couple of notes for the Ansible role: the `rustup` install and the source `~/.cargo/env` step will need some care — you'll want to run the cargo/make steps with the correct environment for whichever user the role runs as, likely via a become_user with the right shell `env` loaded. Also worth caching that `libkrunfw.so` artifact somewhere accessible to the role so you can skip the kernel build on future runs.
