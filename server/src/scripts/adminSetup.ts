// Optional: prints ADMIN_PASSWORD_HASH for people who prefer not to keep ADMIN_PASSWORD in env.
// Usage: npm run admin:hash (or, in the container from /app/server: node --experimental-strip-types src/scripts/adminSetup.ts)
import { createInterface } from 'node:readline';
import { config } from '../config.ts';
import { hashPassword } from '../services/admin/auth.ts';

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/, '');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
  let muted = false;
  rlAny._writeToOutput = (s: string) => {
    if (!muted) process.stdout.write(s);
  };
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const password = await readHidden('Admin password: ');
  if (password.length < config.admin.minPasswordLength) {
    console.error(`Password must be at least ${config.admin.minPasswordLength} characters.`);
    process.exit(1);
  }
  if (process.stdin.isTTY && (await readHidden('Repeat password: ')) !== password) {
    console.error('Passwords do not match.');
    process.exit(1);
  }
  console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(password)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
