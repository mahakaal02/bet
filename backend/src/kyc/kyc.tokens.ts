/**
 * DI tokens for the KYC subsystem. Kept in a separate file so the
 * service + module + spec can import them without circular deps via
 * the adapter files (which themselves import from this module).
 */
export const KYC_STORAGE = Symbol('KYC_STORAGE');
export const VIRUS_SCANNER = Symbol('VIRUS_SCANNER');
export const DOCUMENT_CIPHER = Symbol('DOCUMENT_CIPHER');

export type { KycStorage } from './kyc-storage';
export type { VirusScanner } from './virus-scanner';
export type { DocumentCipher } from './document-cipher';
