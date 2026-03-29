from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
from ansible.plugins.connection import ConnectionBase
from ansible.utils.display import Display

display = Display()

DOCUMENTATION = """
    name: sprite
    short_description: Run commands on a Sprite via the sprite CLI
    description:
      - Executes commands on a remote Sprite using C(sprite exec).
      - Transfers files using C(sprite exec --file).
    options:
      sprite_name:
        description: Name of the target Sprite.
        vars:
          - name: sprite_name
        required: true
      sprite_org:
        description: Sprites organization name (optional).
        vars:
          - name: sprite_org
        required: false
"""


class Connection(ConnectionBase):
  transport = "sprite"
  has_pipelining = False

  def __init__(self, *args, **kwargs):
    super().__init__(*args, **kwargs)
    self._sprite_name = None
    self._sprite_org = None

  @property
  def _base_cmd(self) -> list[str]:
    if not self._sprite_name:
        self._connect()
    cmd = ["sprite", "exec"]
    if self._sprite_org:
        cmd += ["--org", self._sprite_org]
    cmd += ["--sprite", self._sprite_name]
    return cmd

  def _connect(self):
    self._sprite_name = self.get_option("sprite_name")
    self._sprite_org = self.get_option("sprite_org")
    display.vvv(f"SPRITE connect: {self._sprite_name}", host=self._sprite_name)
    return self

  def exec_command(self, cmd: str, in_data=None, sudoable=True):
    """Run a command on the Sprite and return (rc, stdout, stderr)."""
    full_cmd = self._base_cmd + ["--", *shlex.split(cmd)]
    display.vvv(f"SPRITE exec: {full_cmd}", host=self._sprite_name)

    proc = subprocess.run(
      full_cmd,
      input=in_data,
      capture_output=True,
    )
    return proc.returncode, proc.stdout, proc.stderr

  def put_file(self, in_path: str, out_path: str):
    """Upload a file to the Sprite using --file <src:dest>."""
    display.vvv(f"SPRITE put: {in_path} -> {out_path}", host=self._sprite_name)
    full_cmd = self._base_cmd + [
      "--file", f"{in_path}:{out_path}",
      "--", "true",  # no-op command; we just need the upload
    ]
    proc = subprocess.run(full_cmd, capture_output=True)
    if proc.returncode != 0:
      raise Exception(f"sprite put_file failed: {proc.stderr.decode()}")

  def fetch_file(self, in_path: str, out_path: str):
    """Download a file from the Sprite by catting it over exec stdout."""
    display.vvv(f"SPRITE fetch: {in_path} -> {out_path}", host=self._sprite_name)
    full_cmd = self._base_cmd + ["--", "cat", in_path]
    proc = subprocess.run(full_cmd, capture_output=True)
    if proc.returncode != 0:
      raise Exception(f"sprite fetch_file failed: {proc.stderr.decode()}")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
      f.write(proc.stdout)

  def close(self):
    pass
