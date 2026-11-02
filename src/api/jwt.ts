import { Native } from '../platform/native';
import { Obj } from '../utils/parse';

const b64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function jwtHS256(payload: Obj, secret: string): Promise<string> {
  const header = b64url(await Native.base64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(await Native.base64(JSON.stringify(payload)));
  const input = `${header}.${body}`;
  const sig = b64url(await Native.hexToBase64(await Native.hmacHex('sha256', secret, input)));
  return `${input}.${sig}`;
}
