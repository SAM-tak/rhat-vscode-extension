// The editor delegates language semantics to rhatls over stdio.
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    CloseAction, ErrorAction, LanguageClient, LanguageClientOptions,
    ServerOptions,
} from 'vscode-languageclient/node';
import { isRhatSource, resolveServer, ServerSettings } from './server';

class ServerController {
    private client: LanguageClient | undefined;
    private watchers: vscode.Disposable[] = [];
    private operations: Promise<void> = Promise.resolve();
    private generation = 0;
    private disposed = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly output: vscode.LogOutputChannel,
    ) {}

    private settings(): ServerSettings {
        const config = vscode.workspace.getConfiguration('rhat');
        return {
            serverPath: config.get<string>('serverPath', ''),
            stdlibPath: config.get<string>('stdlibPath', ''),
            modulePaths: config.get<string[]>('modulePaths', []),
            autoRestart: config.get<boolean>('serverAutoRestart', true),
        };
    }

    private async stopClient(): Promise<void> {
        this.watchers.splice(0).forEach(disposable => disposable.dispose());
        const previous = this.client;
        this.client = undefined;
        if (previous) {
            await previous.dispose(5000);
        }
    }

    private watchSources(client: LanguageClient, directories: string[]): void {
        const unique = new Map(directories.map(directory => [
            process.platform === 'win32' ? directory.toLowerCase() : directory, directory,
        ]));
        for (const directory of unique.values()) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(directory, '**/*.rh'),
            );
            this.watchers.push(watcher);
            const notify = (uri: vscode.Uri, type: number): void => {
                if (!client.isRunning() || !isRhatSource(uri.fsPath)) {
                    return;
                }
                void client.sendNotification('workspace/didChangeWatchedFiles', {
                    changes: [{ uri: uri.toString(), type }],
                }).catch(error => this.output.debug(String(error)));
            };
            this.watchers.push(
                watcher.onDidCreate(uri => notify(uri, 1)),
                watcher.onDidChange(uri => notify(uri, 2)),
                watcher.onDidDelete(uri => notify(uri, 3)),
            );
        }
    }

    /** Serialize restarts so a settings change cannot orphan a native process. */
    restart(): Promise<void> {
        const generation = ++this.generation;
        this.operations = this.operations.then(async () => {
            if (generation !== this.generation || this.disposed) {
                return;
            }
            await this.stopClient();
            if (!vscode.workspace.isTrusted) {
                this.output.info('Syntax highlighting is active. Trust the workspace to start rhatls.');
                return;
            }
            const settings = this.settings();
            const folders = (vscode.workspace.workspaceFolders ?? [])
                .filter(folder => folder.uri.scheme === 'file')
                .map(folder => ({ name: folder.name, path: folder.uri.fsPath }));
            const active = vscode.window.activeTextEditor?.document.uri;
            const baseDirectory = active?.scheme === 'file' ? path.dirname(active.fsPath) : undefined;
            const launch = resolveServer(settings, {
                extensionPath: this.context.extensionPath,
                development: this.context.extensionMode === vscode.ExtensionMode.Development,
                folders, baseDirectory,
            });
            this.output.info(`Starting rhatls (${launch.source}): ${launch.command}`);
            const serverOptions: ServerOptions = {
                command: launch.command,
                args: launch.args,
                options: { cwd: launch.cwd, shell: false },
            };
            const clientOptions: LanguageClientOptions = {
                documentSelector: [{ scheme: 'file', language: 'rhat' }],
                diagnosticCollectionName: 'rhat',
                outputChannel: this.output,
                initializationOptions: { modulePaths: launch.modulePaths },
                errorHandler: settings.autoRestart ? undefined : {
                    error: () => ({ action: ErrorAction.Continue }),
                    closed: () => ({ action: CloseAction.DoNotRestart }),
                },
            };
            const client = new LanguageClient('rhatLanguageServer', 'R^ Language Server', serverOptions, clientOptions);
            this.client = client;
            this.watchSources(client, [
                ...folders.map(folder => folder.path), ...launch.modulePaths,
                ...(launch.stdlibPath ? [launch.stdlibPath] : []),
                ...(!folders.length && baseDirectory ? [baseDirectory] : []),
            ]);
            await client.start();
            this.output.info('rhatls is ready.');
        }).catch(async (error: unknown) => {
            const reason = error instanceof Error ? error.message : String(error);
            this.output.error(reason);
            try { await this.stopClient(); } catch (stopError) { this.output.error(String(stopError)); }
            if (!this.disposed && generation === this.generation) {
                void Promise.resolve(vscode.window.showErrorMessage(
                    `Could not start rhatls: ${reason}. Set rhat.serverPath to the native language server.`,
                    'Open Settings', 'Show Output',
                )).then(async selection => {
                    if (selection === 'Open Settings') {
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'rhat.serverPath');
                    } else if (selection === 'Show Output') {
                        this.output.show(true);
                    }
                }).catch(actionError => this.output.error(String(actionError)));
            }
        });
        return this.operations;
    }

    stop(): Promise<void> {
        ++this.generation;
        this.operations = this.operations.then(() => this.stopClient()).catch(error => {
            this.output.error(String(error));
        });
        return this.operations;
    }

    shutdown(): Promise<void> {
        this.disposed = true;
        return this.stop();
    }
}

let controller: ServerController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('R^ Language Server', { log: true });
    const server = new ServerController(context, output);
    controller = server;
    context.subscriptions.push(
        output,
        vscode.commands.registerCommand('rhat.restartServer', () => server.restart()),
        vscode.commands.registerCommand('rhat.stopServer', () => server.stop()),
        vscode.commands.registerCommand('rhat.showOutput', () => output.show(true)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('rhat')) {
                void server.restart();
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => { void server.restart(); }),
        vscode.workspace.onDidGrantWorkspaceTrust(() => { void server.restart(); }),
    );
    await server.restart();
}

export async function deactivate(): Promise<void> {
    await controller?.shutdown();
    controller = undefined;
}
