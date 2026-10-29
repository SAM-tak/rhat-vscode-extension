// Native server discovery is kept independent of VS Code for command-line tests.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ResolutionContext {
    extensionPath: string;
    development: boolean;
    folders: readonly { name: string; path: string }[];
    baseDirectory?: string;
    environment?: NodeJS.ProcessEnv;
}

export interface ServerSettings {
    serverPath: string;
    stdlibPath: string;
    modulePaths: readonly string[];
    autoRestart: boolean;
}

export interface ServerLaunch {
    command: string;
    args: string[];
    modulePaths: string[];
    stdlibPath?: string;
    cwd?: string;
    source: 'configured' | 'bundled' | 'development' | 'path';
}

/** Expand editor-style variables without interpreting shell syntax. */
export function expandSetting(value: string, context: ResolutionContext): string {
    const environment = context.environment ?? process.env;
    let expanded = value.trim().replace(/\$\{([^}]+)\}/g, (_match, variable: string) => {
        if (variable.startsWith('env:')) {
            const name = variable.slice(4);
            const found = environment[name];
            if (found === undefined) {
                throw new Error(`Environment variable ${name} is not set.`);
            }
            return found;
        }
        if (variable === 'workspaceFolder' || variable.startsWith('workspaceFolder:')) {
            const name = variable.slice('workspaceFolder:'.length);
            const folder = variable === 'workspaceFolder'
                ? context.folders[0]
                : context.folders.find(item => item.name === name);
            if (!folder) {
                throw new Error(`Cannot resolve \u0024{${variable}} without a matching workspace folder.`);
            }
            return folder.path;
        }
        throw new Error(`Unsupported path variable: \u0024{${variable}}.`);
    });
    if (/^~(?:[\\/]|$)/.test(expanded)) {
        expanded = path.join(os.homedir(), expanded.slice(1));
    }
    return expanded;
}

function absoluteSetting(value: string, context: ResolutionContext): string {
    const expanded = expandSetting(value, context);
    if (!expanded) {
        throw new Error('Search paths must not be empty.');
    }
    if (path.isAbsolute(expanded)) {
        return path.normalize(expanded);
    }
    const base = context.folders[0]?.path ?? context.baseDirectory;
    if (!base) {
        throw new Error(`Use an absolute path for ${value}, or open a workspace folder.`);
    }
    return path.resolve(base, expanded);
}

function checkExecutable(command: string, restoreExecuteBit = false): string {
    if (!fs.statSync(command).isFile()) {
        throw new Error(`Not a language-server executable: ${command}`);
    }
    if (process.platform !== 'win32') {
        if (restoreExecuteBit) {
            const mode = fs.statSync(command).mode;
            if ((mode & 0o111) === 0) {
                fs.chmodSync(command, mode | 0o755);
            }
        }
        fs.accessSync(command, fs.constants.X_OK);
    }
    return command;
}

/** Produce the exact stdio launch and initialization paths used by the client. */
export function resolveServer(settings: ServerSettings, context: ResolutionContext): ServerLaunch {
    const executable = process.platform === 'win32' ? 'rhat.exe' : 'rhat';
    let command: string;
    let source: ServerLaunch['source'];
    if (settings.serverPath.trim()) {
        command = expandSetting(settings.serverPath, context);
        if (path.isAbsolute(command) || /[\\/]/.test(command)) {
            command = checkExecutable(absoluteSetting(settings.serverPath, context));
        }
        source = 'configured';
    } else {
        const bundled = path.join(context.extensionPath, 'bin', executable);
        // rhat's build copies the compiler to .rhat-ls, so that rebuilding does not
        // fight a running server for the executable; the build directory is a fallback.
        const checkout = path.resolve(context.extensionPath, '..', 'rhat');
        const candidates = context.development
            ? [path.join(checkout, '.rhat-ls', executable),
               ...['Debug', 'Release', ''].map(config => path.join(checkout, 'build', config, executable))]
            : [];
        const development = candidates.find(file => fs.existsSync(file));
        if (fs.existsSync(bundled)) {
            command = checkExecutable(bundled, true);
            source = 'bundled';
        } else if (development) {
            command = checkExecutable(development);
            source = 'development';
        } else {
            command = executable;
            source = 'path';
        }
    }
    const modulePaths = [...new Map(settings.modulePaths.map(value => {
        const absolute = absoluteSetting(value, context);
        return [process.platform === 'win32' ? absolute.toLowerCase() : absolute, absolute];
    })).values()];
    const stdlibPath = settings.stdlibPath.trim()
        ? absoluteSetting(settings.stdlibPath, context) : undefined;
    return {
        command,
        args: ['lsp', '--stdio', ...(stdlibPath ? ['--stdlib', stdlibPath] : [])],
        modulePaths,
        stdlibPath,
        cwd: context.folders[0]?.path ?? context.baseDirectory,
        source,
    };
}

/** Ignore generated caches and dependencies when forwarding source-file events. */
export function isRhatSource(file: string): boolean {
    return path.extname(file).toLowerCase() === '.rh'
        && !file.split(/[\\/]/).some(part => ['.git', '.rhat-cache', 'node_modules'].includes(part));
}
