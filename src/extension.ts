'use strict';
import * as vscode from 'vscode';
import PloneFS, { CredentialStore } from './PloneFS';
import { Document, File } from './library/plone';

export function activate(context: vscode.ExtensionContext) {
	console.log('PloneFS says "Hello"', context.storagePath);
	let credentialStore = context.workspaceState.get<CredentialStore>('credentialStore', {});
	const ploneFS = new PloneFS(credentialStore);
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('plone', ploneFS, { isCaseSensitive: false }));
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
		let uriValue = await vscode.window.showInputBox({
			value: 'louisville.edu/',
			prompt: 'Open Plone site',
		});

		if (uriValue) {
			// force final slash
			uriValue = uriValue.replace(/\/+$/, '/');
			const uri = vscode.Uri.parse('plone://' + uriValue);
			if (uri) {
				const credentials = credentialStore[uri.authority + uri.path];
				let username, password;
				if (credentials) {
					({ username, password } = credentials);
				}
				else {
					username = await vscode.window.showInputBox({
						prompt: 'Username',
					});
					password = await vscode.window.showInputBox({
						prompt: 'Password',
						password: true,
					});
				}

				credentialStore[uri.authority + uri.path] = { username, password };
				context.workspaceState.update('credentialStore', credentialStore);

				// so far it doesn't matter if I register a plone provider updating the workspace
				// the only thing that has worked so far is making a plone scheme activation event
				// and attaching the provider after the extension is activated again
				const updated = vscode.workspace.updateWorkspaceFolders(
					0, 0, {
						name: uri.path,
						uri,
					},
				);
			}
		}
	}));
}

