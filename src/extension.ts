'use strict';
import * as vscode from 'vscode';
import PloneFS, { CookieStore } from './PloneFS';
import { Document, File } from './library/plone';
const cookieStoreName = 'cookieStore';
export function activate(context: vscode.ExtensionContext) {
	console.log('PloneFS says "Hello"', context.storagePath);

	const channel = vscode.window.createOutputChannel('PloneFS');
	let cookieStore = context.workspaceState.get<CookieStore>(cookieStoreName, {});
	const ploneFS = new PloneFS(cookieStore);
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('plone', ploneFS, { isCaseSensitive: false }));
	// to VS Code Plone Documents and Plone Files are both TextDocuments
	// so set Plone Documents to be HTML and Files to be whatever we determined them to be
	// (unless VS Code already figured it out)
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async doc => {
		if (doc.languageId === 'plaintext') {
			const stat: vscode.FileStat = await ploneFS.stat(doc.uri);
			if (stat instanceof Document) {
				vscode.languages.setTextDocumentLanguage(doc, 'html');
			}
			else if (stat instanceof File && stat.language && stat.language !== 'plaintext') {
				vscode.languages.setTextDocumentLanguage(doc, stat.language);
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('plonefs.workspace', async () => {
		let uri: vscode.Uri | undefined, cookie: string | undefined;
		while (!cookie) {
			let uriValue = await vscode.window.showInputBox({
				value: 'louisville.edu/',
				prompt: 'Open Plone site',
			});
			// cancelled
			if (uriValue === undefined) {
				return;
			}
			else {
				// force final slash
				uriValue = uriValue.replace(/\/*$/, '/');
				uri = vscode.Uri.parse('plone://' + uriValue);
				if (uri) {
					const testCookie = cookieStore[uri.authority + uri.path];
					if (typeof testCookie === 'string') {
						cookie = testCookie;
					}
					else {
						const username = await vscode.window.showInputBox({
							prompt: 'Username',
						});
						// cancelled
						if (username === undefined) {
							return;
						}
						const password = await vscode.window.showInputBox({
							prompt: 'Password',
							password: true,
						});
						// cancelled
						if (password === undefined) {
							return;
						}
						try {
							cookie = await PloneFS.login(uri, { username, password });
						}
						catch (e) {
							channel.appendLine('login failed');
							channel.show(true);
						}
					}
				}
			}
		}
		// so far it doesn't matter if I register a plone provider updating the workspace
		// the only thing that has worked so far is making a plone scheme activation event
		// and attaching the provider after the extension is activated again
		// uri should always be set, check here is for TypeScript
		if (uri) {
			cookieStore[uri.authority + uri.path] = cookie;
			context.workspaceState.update(cookieStoreName, cookieStore);
			vscode.workspace.updateWorkspaceFolders(
				0, 0, {
					name: uri.path,
					uri,
				},
			);
		}
	}));
}

