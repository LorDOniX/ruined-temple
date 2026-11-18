declare module '@wowserhq/stormjs' {
  interface MpqFile {
    read(): Uint8Array;
    close(): void;
  }
  interface Mpq {
    hasFile(name: string): boolean;
    openFile(name: string): MpqFile;
    close(): void;
  }
  export const MPQ: { open(path: string, mode?: string): Promise<Mpq> };
  export const FS: {
    mkdir(path: string): void;
    mount(type: unknown, opts: { root: string }, mountpoint: string): void;
    filesystems: { NODEFS: unknown };
  };
}
