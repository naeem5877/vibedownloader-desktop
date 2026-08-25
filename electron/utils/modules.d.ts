declare module 'crx3' {
    interface Crx3Options {
        name?: string;
        crxPath?: string;
        zipPath?: string;
        keyPath?: string;
        xmlPath?: string;
        appVersion?: string;
        crxURL?: string;
        browserVersion?: string;
        srcPaths?: string[];
        forceDateTime?: number;
    }

    interface Crx3Result {
        appId: string;
        newKey?: string | null;
        crxPath: string;
        keyPath?: string;
    }

    export default function crx3(files: string[], options?: Crx3Options): Promise<Crx3Result>;
}

declare module 'adm-zip' {
    interface IZipEntry {
        entryName: string;
        getData(): Buffer;
        isDirectory: boolean;
    }

    class AdmZip {
        constructor(filePath?: string | Buffer);
        getEntries(): IZipEntry[];
        addFile(entryName: string, data: Buffer, comment?: string): void;
        writeZip(targetPath?: string): void;
        readAsText(entryName: string, encoding?: string): string;
    }

    export = AdmZip;
}
