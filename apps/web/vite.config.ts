import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { rejectBrowserSecrets, validateBrowserEnvironment } from '@neon/protocol';

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  rejectBrowserSecrets(env);
  if (command === 'build') validateBrowserEnvironment(env, { production: true, allowLocal: env.NEON_LOCAL_BUILD === 'true' });
  return { plugins: [react()], server: { host: '127.0.0.1', port: 5173, strictPort: true } };
});
