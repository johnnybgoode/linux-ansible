#!/usr/bin/env node

// https://code.claude.com/docs/en/statusline

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', RESET = '\x1b[0m', BOLD = '\x1b[1m';
const BACK = '░', FILL = '▓';

const CACHE_MAX_AGE = 5;

const cacheFileName = (sessId) => `/tmp/claude-status-${sessId}`
const cacheIsStale = (file) => {
  if (!fs.existsSync(file)) return true;
  return (Date.now() / 1000) - fs.statSync(file).mtimeMs / 1000 > CACHE_MAX_AGE;
}

const getColorFor = (pct) => pct < 50 ? GREEN : pct < 80 ? YELLOW : RED;

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const data = JSON.parse(input);
  const model = data.model.display_name;
  const currentDir = data.workspace.current_dir;
  const dirParts = currentDir.split(path.sep);
  const worktreeIdx = dirParts.lastIndexOf('.worktrees');
  const inWorktreesDir = worktreeIdx !== -1 && worktreeIdx === dirParts.length - 2;
  const dirName = path.basename(currentDir);

  const ctxPct = Math.floor(data.context_window?.used_percentage || 0)
  const filled = Math.floor(ctxPct * 10 / 100)
  const ctxColor = getColorFor(ctxPct)
  const ctxBar = `${ctxColor}${'▓'.repeat(filled) + '░'.repeat(10 - filled)} ${ctxPct}%${RESET}`;

  const limitParts = [
    data.rate_limits?.five_hour?.used_percentage,
    data.rate_limits?.seven_day?.used_percentage,
  ].filter(Boolean).map(l => {
    const limPct = Math.floor(l)
    return `${getColorFor(limPct)}${limPct}%${RESET}`
  });

  let usagePart = `${ctxBar}`
  usagePart += limitParts.length ? ` ${BOLD}[${limitParts.join('/')}]${RESET}` : ''

  const CACHE_FILE = cacheFileName(data.session_id)

  if (cacheIsStale(CACHE_FILE)) {
    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore' });
      const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
      const staged = execSync('git diff --cached --numstat', { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
      const modified = execSync('git diff --numstat', { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
      fs.writeFileSync(CACHE_FILE, `${branch}|${staged}|${modified}`);

    } catch {
      fs.writeFileSync(CACHE_FILE, '||');
    }
  }

  const [branch, staged, modified] = fs.readFileSync(CACHE_FILE, 'utf8').trim().split('|');

  let gitStatus = staged ? `${GREEN}+${staged}${RESET}` : '';
  gitStatus += modified ? `${YELLOW}~${modified}${RESET}` : '';

  const hideDir = inWorktreesDir && dirName === branch;
  const dirPart = hideDir ? '' : `📁 ${dirName} | `;
  if (branch) {
    console.log(`[${model}] ${dirPart}🌿 ${branch} ${gitStatus} | ${usagePart}`);
  }
  else {
    console.log(`[${model}] ${dirPart}${usagePart}`);
  }

});
