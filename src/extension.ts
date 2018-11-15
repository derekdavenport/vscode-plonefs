'use strict';
import * as vscode from 'vscode';
import { PloneFS, Document, Credentials, CredentialStore } from './ploneFS';

export function activate(context: vscode.ExtensionContext) {
	console.log('PloneFS says "Hello"', context.storagePath);
	let credentialStore = context.workspaceState.get<CredentialStore>('credentialStore', {});
	const ploneFS = new PloneFS(credentialStore);
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('plone', ploneFS, { isCaseSensitive: false }));
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(doc => {
		if (doc.languageId === 'plaintext') {
			const stat = ploneFS.stat(doc.uri);
			if (stat instanceof Document) {
				vscode.languages.setTextDocumentLanguage(doc, 'html');
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

