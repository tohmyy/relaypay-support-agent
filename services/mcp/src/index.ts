import { loadEnv } from './env';

const env = loadEnv();
console.log('environment ok', Object.keys(env).length, 'variables');
