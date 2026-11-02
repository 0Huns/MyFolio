import { NativeModules } from 'react-native';

type MFNativeModule = {
  keychainSet(key: string, value: string): Promise<boolean>;
  keychainGet(key: string): Promise<string | null>;
  keychainDelete(key: string): Promise<boolean>;
  readData(): Promise<string | null>;
  writeData(text: string): Promise<boolean>;
  hmacHex(alg: 'sha256' | 'sha512', key: string, message: string): Promise<string>;
  sha512Hex(message: string): Promise<string>;
  base64(text: string): Promise<string>;
  hexToBase64(hex: string): Promise<string>;
  saveFile(name: string, content: string): Promise<boolean>;
  setAppearance(mode: 'system' | 'light' | 'dark'): Promise<boolean>;
  /** iOS background refresh: JS is ready for `backgroundRefresh` events / finished one. No-ops on macOS. */
  backgroundReady(): Promise<boolean>;
  backgroundDone(success: boolean): Promise<boolean>;
  /** macOS desktop widget: write its summary JSON to the shared App Group container. No-op elsewhere. */
  writeWidget(json: string): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
};

export const Native: MFNativeModule = NativeModules.MFNative;

export type Credentials = { key: string; secret: string };

export const Keychain = {
  get: (k: string) => Native.keychainGet(k),
  set: (k: string, v: string) => Native.keychainSet(k, v),
  delete: (k: string) => Native.keychainDelete(k),

  async credentials(accountId: string): Promise<Credentials | null> {
    const s = await Native.keychainGet(`account-${accountId}`);
    return s ? (JSON.parse(s) as Credentials) : null;
  },
  saveCredentials: (accountId: string, c: Credentials) =>
    Native.keychainSet(`account-${accountId}`, JSON.stringify(c)),
  async deleteAccount(accountId: string) {
    await Native.keychainDelete(`account-${accountId}`);
    await Native.keychainDelete(`token-${accountId}`);
  },

  /** Cached OAuth token (KIS allows ~1 issuance/minute, so reuse until 10 min before expiry). */
  async token(accountId: string): Promise<string | null> {
    const s = await Native.keychainGet(`token-${accountId}`);
    if (!s) return null;
    const t = JSON.parse(s) as { token: string; expires: number };
    return t.expires > Date.now() + 600_000 ? t.token : null;
  },
  saveToken: (accountId: string, token: string, expires: number) =>
    Native.keychainSet(`token-${accountId}`, JSON.stringify({ token, expires })),
  dropToken: (accountId: string) => Native.keychainDelete(`token-${accountId}`),
};

/** Keychain entry of the Korea Eximbank API key. */
export const EXIM_KEY = 'exim-fx';
