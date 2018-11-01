'use strict';

import * as vscode from 'vscode';
import { PloneFS, Page } from './ploneFS';

export async function activate(context: vscode.ExtensionContext) {

	console.log('PloneFS says "Hello"')

	context.subscriptions.push(vscode.commands.registerCommand('plonefs.openURI', async () => {
		const uriValue = await vscode.window.showInputBox({
			value: 'plone://' + 'louisville.edu/nursing/',
			prompt: 'Open Plone site',
			validateInput: input => {
				let error: string = '';
				try {
					const uri = vscode.Uri.parse(input.trim());
					if ('plone' !== uri.scheme) {
						error = 'must be http(s)';
					}
				}
				catch (e) {
					if (e instanceof Error)
						error = e.message;
					else
						error = e.toString();
				}
				return error;
			},
		});
		// TODO get username and password
		const inputBox = await vscode.window.createInputBox();
		const credentials = inputBox;

		if (uriValue) {
			const uri = vscode.Uri.parse(uriValue);
			const ploneFs = new PloneFS(uri, '', '');
			context.subscriptions.push(vscode.workspace.registerFileSystemProvider('plone', ploneFs, { isCaseSensitive: false }));

			vscode.workspace.updateWorkspaceFolders(
				0, 0, {
					name: 'plone ' + uri.path,
					uri,
				},
			);
			vscode.workspace.onDidOpenTextDocument(doc => {
				if (doc.languageId == 'plaintext') {
					const stat = ploneFs.stat(doc.uri);
					if (stat instanceof Page) {
						// vscode complaining this function doesn't exist. wut?
						vscode.languages.setTextDocumentLanguage(doc, 'html');
					}
				}
			})
		}
	}));
}

