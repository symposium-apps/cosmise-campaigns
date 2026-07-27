'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const name = 'using-cosmise-campaign-reports';
const source = path.resolve(__dirname, '..', 'skills', name);

function activeProfileRoot() {
  const configuredHome = String(process.env.HERMES_HOME || '').trim();
  const profile = String(process.env.HERMES_PROFILE || '').trim();
  if (configuredHome) {
    const root = path.resolve(configuredHome);
    if (path.basename(root) !== '.hermes') return root;
    if (profile) return path.join(root, 'profiles', profile);
  }
  if (profile) return path.join(os.homedir(), '.hermes', 'profiles', profile);
  throw new Error('Set profile-scoped HERMES_HOME or HERMES_PROFILE before installing this skill.');
}

function install() {
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) throw new Error(`Repository skill is missing: ${source}`);
  const destination = path.join(activeProfileRoot(), 'skills', name);
  const parent = path.dirname(destination);
  const temporary = path.join(parent, `.${name}.${process.pid}.tmp`);
  const backup = path.join(parent, `.${name}.${process.pid}.bak`);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.cpSync(source, temporary, { recursive: true });
  try {
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    fs.renameSync(temporary, destination);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (!fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination);
    throw error;
  }
  console.log(`installed_skill=${name}`);
  console.log(`installed_path=${destination}`);
}

try {
  install();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
